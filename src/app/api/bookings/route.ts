import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { isGreenOpenOn, type GreenSeasonInfo } from "@/lib/season";
import { hasPermission, assertPermissionOrFail, Permission } from "@/lib/permissions";
import { isFeatureEnabled } from "@/lib/features";

/** List bookings for the caller's tenant context (impersonation-aware). */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const canViewAll = await hasPermission(session, tenantId, Permission.bookings_manage);
  const bookings = await prisma.booking.findMany({
    where: { tenantId, ...(canViewAll ? {} : { userId: session.user.id }) },
    include: {
      slots: { include: { rink: true } },
      user: { select: { id: true, name: true, email: true } },
      bookedByUser: { select: { id: true, name: true, email: true } },
      payment: true,
    },
    orderBy: { date: "desc" },
  });

  if (canViewAll) {
    logAudit({ session, action: "pii.booking_players_viewed", entity: "Booking", piiAccess: true, tenantId, meta: { count: bookings.length } });
  }

  return NextResponse.json(bookings);
}

/** Create a booking request. */
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const body = await req.json();
  const { date, slots, bookForUserId, adminOverride, overrideReason, targetTenantId, confirmClash } = body as {
    date?: string;
    slots?: { rinkId: string; timeSlot: string; playerName?: string }[];
    bookForUserId?: string;
    adminOverride?: boolean;
    overrideReason?: string;
    targetTenantId?: string;
    confirmClash?: boolean;
  };

  if (!date || !slots?.length) {
    return jsonError("date and slots[] required");
  }

  // ── Cross-club (federation) booking resolution ──────────────
  // If targetTenantId differs from the session's tenant, this is a
  // cross-club booking via federation. We resolve the booking tenant
  // to the target, and record provenance.
  let bookingTenantId = tenantId; // same-club default
  let bookedByTenantId: string | null = null;
  let federationId: string | null = null;

  if (targetTenantId && targetTenantId !== tenantId) {
    // Federation feature must be enabled on the home club
    if (!(await isFeatureEnabled(tenantId, "federation"))) {
      return jsonError("Federation feature is not enabled", 403);
    }

    // Target club must exist
    const targetTenant = await prisma.tenant.findUnique({ where: { id: targetTenantId }, select: { id: true } });
    if (!targetTenant) return jsonError("Target club not found", 404);

    // User must have federation_book_at_partners permission at home club
    if (!(await hasPermission(session, tenantId, Permission.federation_book_at_partners))) {
      return jsonError("You do not have permission to book at partner clubs", 403);
    }

    // Find a common active federation
    const homeFederations = await prisma.federationMembership.findMany({
      where: { tenantId, leftAt: null, federation: { status: "ACTIVE" } },
      select: { federationId: true },
    });
    const homeFedIds = homeFederations.map((f) => f.federationId);

    if (homeFedIds.length === 0) {
      return jsonError("Your club is not in any active federation", 403);
    }

    const commonMembership = await prisma.federationMembership.findFirst({
      where: { tenantId: targetTenantId, leftAt: null, federationId: { in: homeFedIds }, federation: { status: "ACTIVE" } },
      select: { federationId: true },
    });
    if (!commonMembership) {
      return jsonError("Your club and the target club are not in a common federation", 403);
    }

    bookingTenantId = targetTenantId;
    bookedByTenantId = tenantId;
    federationId = commonMembership.federationId;
  }

  // ── Book-on-behalf logic ────────────────────────────────────
  let bookeeUserId = session.user.id;
  let bookedByUserId = session.user.id;

  if (bookForUserId && bookForUserId !== session.user.id) {
    // Only members with the book-on-behalf permission can book for someone else.
    const permErr = await assertPermissionOrFail(session, tenantId, Permission.bookings_manage);
    if (permErr) return permErr;

    // Target user must belong to the same tenant.
    const targetUser = await prisma.user.findFirst({
      where: { id: bookForUserId, tenantId },
      select: { id: true },
    });
    if (!targetUser) {
      return jsonError("Target user not found in this club", 404);
    }
    bookeeUserId = bookForUserId;
    bookedByUserId = session.user.id;
  }

  // ── Admin override logic ────────────────────────────────────
  const useOverride = adminOverride === true;
  if (useOverride) {
    const permErr = await assertPermissionOrFail(session, tenantId, Permission.bookings_admin_override);
    if (permErr) return permErr;
    if (!overrideReason || typeof overrideReason !== "string" || overrideReason.trim().length === 0) {
      return jsonError("overrideReason is required when adminOverride is true", 400);
    }
  }

  // ── Validate rinks belong to booking tenant ──────────────────
  const rinkIds: string[] = slots.map((s) => s.rinkId);
  const rinks = await prisma.rink.findMany({
    where: { id: { in: rinkIds }, green: { tenantId: bookingTenantId } },
    include: {
      green: {
        select: {
          name: true,
          allWeather: true,
          seasonStartMMDD: true,
          seasonEndMMDD: true,
          seasons: { select: { year: true, startDate: true, endDate: true } },
        },
      },
    },
  });
  if (rinks.length !== rinkIds.length) {
    return jsonError("One or more rinks not found for this club", 404);
  }

  // ── Per-green season enforcement ────────────────────────────
  if (!useOverride) {
    const checkedGreens = new Set<string>();
    for (const rink of rinks) {
      if (checkedGreens.has(rink.greenId)) continue;
      checkedGreens.add(rink.greenId);
      const g = rink.green as GreenSeasonInfo & { name: string };
      if (!isGreenOpenOn(g, date)) {
        return jsonError(
          `${g.name} is closed for the season on ${date}`,
          400,
        );
      }
    }
  }

  // ── Conflict check (skipped when adminOverride) ─────────────
  if (!useOverride) {
    for (const slot of slots) {
      const conflict = await prisma.bookingSlot.findFirst({
        where: {
          rinkId: slot.rinkId,
          timeSlot: slot.timeSlot,
          booking: { date, status: { in: ["APPROVED", "RESERVED", "CONFIRMED"] }, tenantId: bookingTenantId },
        },
      });
      if (conflict) {
        return jsonError(`Rink ${slot.rinkId} slot ${slot.timeSlot} on ${date} is already booked`, 409);
      }
    }
  }

  // ── Cross-club clash detection ──────────────────────────────
  // When booking at a partner club, check whether the user already has
  // bookings on the same date at ANY federated club. Same slot = clash,
  // adjacent slot = travel-time warning. Client confirms to proceed.
  if (federationId && !confirmClash) {
    const requestedSlots = slots.map((s) => s.timeSlot);

    // Find all the user's bookings on this date across all tenants
    const existingBookings = await prisma.booking.findMany({
      where: {
        userId: bookeeUserId,
        date,
        status: { in: ["APPROVED", "RESERVED", "CONFIRMED", "REQUESTED"] },
      },
      include: {
        slots: { select: { timeSlot: true } },
        tenant: { select: { name: true } },
      },
    });

    for (const existing of existingBookings) {
      for (const es of existing.slots) {
        if (requestedSlots.includes(es.timeSlot)) {
          return NextResponse.json(
            {
              error: "CROSS_CLUB_CLASH",
              message: `You already have a booking at ${existing.tenant.name} on ${date} at ${es.timeSlot}`,
              existingBooking: { id: existing.id, tenantName: existing.tenant.name, timeSlot: es.timeSlot },
              confirm: true,
            },
            { status: 409 },
          );
        }
        // Adjacent slot check: compare start/end hours
        const warnAdj = isAdjacentSlot(es.timeSlot, requestedSlots);
        if (warnAdj) {
          return NextResponse.json(
            {
              error: "CROSS_CLUB_CONSECUTIVE",
              message: `You have a booking at ${existing.tenant.name} on ${date} at ${es.timeSlot} — consecutive slots across clubs may not leave travel time`,
              existingBooking: { id: existing.id, tenantName: existing.tenant.name, timeSlot: es.timeSlot },
              confirm: true,
            },
            { status: 409 },
          );
        }
      }
    }
  }

  // ── Create booking ──────────────────────────────────────────
  const booking = await prisma.booking.create({
    data: {
      tenantId: bookingTenantId,
      userId: bookeeUserId,
      bookedByUserId,
      bookedByTenantId: bookedByTenantId,
      federationId: federationId,
      date,
      status: "REQUESTED",
      adminOverride: useOverride,
      overrideReason: useOverride ? overrideReason!.trim().slice(0, 500) : null,
      slots: {
        create: slots.map((s) => {
          const rink = rinks.find((r) => r.id === s.rinkId);
          return {
            rinkId: s.rinkId,
            timeSlot: s.timeSlot,
            playerName: s.playerName ?? null,
          };
        }),
      },
    },
    include: { slots: true },
  });

  const meta: Record<string, unknown> = { date, slotCount: slots.length };
  if (bookeeUserId !== bookedByUserId) meta.bookedFor = bookeeUserId;
  if (useOverride) {
    meta.adminOverride = true;
    meta.overrideReason = overrideReason!.trim();
  }
  if (federationId) {
    meta.crossClub = true;
    meta.homeTenantId = bookedByTenantId;
    meta.federationId = federationId;
  }

  logAudit({ session, action: "booking.created", entity: "Booking", entityId: booking.id, tenantId: bookingTenantId, meta });

  return NextResponse.json(booking, { status: 201 });
}

/**
 * Check if an existing slot's time is adjacent to any requested slot.
 * "10:00-12:00" is adjacent to "12:00-14:00" (end of one = start of other).
 */
function isAdjacentSlot(existingSlot: string, requestedSlots: string[]): boolean {
  const [, existingEnd] = existingSlot.split("-");
  const existingStart = existingSlot.split("-")[0];
  if (!existingEnd || !existingStart) return false;

  for (const rs of requestedSlots) {
    const [reqStart, reqEnd] = rs.split("-");
    if (existingEnd === reqStart || reqEnd === existingStart) return true;
  }
  return false;
}
