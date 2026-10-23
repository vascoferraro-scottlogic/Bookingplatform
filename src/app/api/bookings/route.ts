import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { isGreenOpenOn, type GreenSeasonInfo } from "@/lib/season";
import { hasPermission, assertPermissionOrFail, Permission } from "@/lib/permissions";
import { isFeatureEnabled, moduleFlagOrFail } from "@/lib/features";
import { createNotification, type NotificationType } from "@/lib/notifications";
import {
  DEFAULT_CLOSING_TIME,
  DEFAULT_OPENING_TIME,
  SLOT_MINUTES,
  isValidIsoDate,
  parseTimeSlot,
  todayInTimezone,
} from "@/lib/time-slots";

/** Only these bookings hold a slot (D-02). */
const BLOCKING_STATUSES = ["RESERVED", "CONFIRMED"] as const;

/** List bookings for the caller's tenant context (impersonation-aware). */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const canViewAll = await hasPermission(session, tenantId, Permission.bookings_manage);
  const include = {
    slots: { include: { rink: true } },
    user: { select: { id: true, name: true, email: true } },
    bookedByUser: { select: { id: true, name: true, email: true } },
    payment: true,
  };
  const ownClubBookings = await prisma.booking.findMany({
    where: { tenantId, ...(canViewAll ? {} : { userId: session.user.id }) },
    include,
    orderBy: { date: "desc" },
  });
  // The caller's own bookings made at partner clubs (federation) belong to
  // this club's members too, so they can see (and cancel) them.
  const partnerClubBookings = await prisma.booking.findMany({
    where: { bookedByTenantId: tenantId, userId: session.user.id },
    include,
    orderBy: { date: "desc" },
  });
  const seen = new Set<string>();
  const bookings = [...ownClubBookings, ...(partnerClubBookings ?? [])]
    .filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  if (canViewAll) {
    logAudit({ session, action: "pii.booking_players_viewed", entity: "Booking", piiAccess: true, tenantId, meta: { count: bookings.length } });
  }

  return NextResponse.json(bookings);
}

/** Create a booking request. */
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const flagErr = await moduleFlagOrFail(session, "bookings");
  if (flagErr) return flagErr;

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

  if (!isValidIsoDate(date)) {
    return jsonError("date must be a valid date in YYYY-MM-DD format");
  }

  // The same rink at the same time can't be requested twice in one booking.
  const seenSlots = new Set<string>();
  for (const s of slots) {
    const key = `${s?.rinkId}|${s?.timeSlot}`;
    if (seenSlots.has(key)) {
      return jsonError(`Duplicate slot: rink ${s.rinkId} at ${s.timeSlot} was requested more than once`, 400);
    }
    seenSlots.add(key);
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
    const targetTenant = await prisma.tenant.findUnique({ where: { id: targetTenantId }, select: { id: true, active: true, status: true } });
    if (!targetTenant) return jsonError("Target club not found", 404);

    // Target club must be active and have federation enabled itself
    if (!targetTenant.active || targetTenant.status !== "ACTIVE") {
      return jsonError("Target club is not active", 403);
    }
    if (!(await isFeatureEnabled(targetTenantId, "federation"))) {
      return jsonError("Target club has not enabled federation", 403);
    }

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
    // The override applies at the club being booked, so check the permission there.
    const permErr = await assertPermissionOrFail(session, bookingTenantId, Permission.bookings_admin_override);
    if (permErr) return permErr;
    if (!overrideReason || typeof overrideReason !== "string" || overrideReason.trim().length === 0) {
      return jsonError("overrideReason is required when adminOverride is true", 400);
    }
  }

  // ── Opening hours and date (booking club's hours and timezone) ──
  const bookingTenant = await prisma.tenant.findUnique({
    where: { id: bookingTenantId },
    select: { openingTime: true, closingTime: true, timezone: true },
  });
  const openingTime = bookingTenant?.openingTime ?? DEFAULT_OPENING_TIME;
  const closingTime = bookingTenant?.closingTime ?? DEFAULT_CLOSING_TIME;
  const openMin = parseTimeSlot(openingTime);
  const closeMin = parseTimeSlot(closingTime);
  for (const s of slots) {
    const t = parseTimeSlot(s?.timeSlot);
    if (t === null) {
      return jsonError(`Invalid timeSlot "${s?.timeSlot}": use HH:MM`, 400);
    }
    if (openMin === null || closeMin === null || t < openMin || t + SLOT_MINUTES > closeMin) {
      return jsonError(`timeSlot ${s.timeSlot} is outside opening hours (${openingTime}–${closingTime})`, 400);
    }
  }
  if (date < todayInTimezone(bookingTenant?.timezone)) {
    return jsonError("date is in the past", 400);
  }

  // ── Validate rinks belong to booking tenant (archived greens/rinks aren't bookable) ──
  const rinkIds: string[] = [...new Set(slots.map((s) => s.rinkId))];
  const rinks = await prisma.rink.findMany({
    where: { id: { in: rinkIds }, archivedAt: null, green: { tenantId: bookingTenantId, archivedAt: null } },
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

  // ── Per-green season enforcement (applies to overrides too) ──
  const checkedGreens = new Set<string>();
  for (const rink of rinks) {
    if (checkedGreens.has(rink.greenId)) continue;
    checkedGreens.add(rink.greenId);
    const g = rink.green as GreenSeasonInfo & { name: string };
    if (!isGreenOpenOn(g, date, bookingTenant?.timezone ?? undefined)) {
      return jsonError(
        `${g.name} is closed for the season on ${date}`,
        400,
      );
    }
  }

  // ── Conflict check ──────────────────────────────────────────
  // Only RESERVED/CONFIRMED bookings hold a slot (D-02). A normal booking is
  // refused on a clash; an admin override goes ahead and the displaced
  // bookings' owners are notified once the new booking exists.
  const displaced = new Map<string, { userId: string; slot: string }>();
  for (const slot of slots) {
    const held = await prisma.bookingSlot.findFirst({
      where: {
        rinkId: slot.rinkId,
        timeSlot: slot.timeSlot,
        booking: { date, status: { in: [...BLOCKING_STATUSES] }, tenantId: bookingTenantId },
      },
      include: { booking: { select: { id: true, userId: true } } },
    });
    if (held && !useOverride) {
      return jsonError(`Rink ${slot.rinkId} slot ${slot.timeSlot} on ${date} is already booked`, 409);
    }
    if (held?.booking?.userId && !displaced.has(held.booking.id)) {
      displaced.set(held.booking.id, { userId: held.booking.userId, slot: slot.timeSlot });
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
        // Clashes are with the user's bookings at OTHER clubs.
        tenantId: { not: bookingTenantId },
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

  // Tell the owners of any bookings the override displaced.
  const displacedIds: string[] = [];
  for (const [displacedId, d] of displaced) {
    if (d.userId === bookeeUserId) continue;
    await createNotification({
      tenantId: bookingTenantId,
      userId: d.userId,
      type: "BOOKING_OVERRIDE" as NotificationType,
      title: "Booking overridden",
      body: `A club administrator has overridden your booking for ${date} at ${d.slot}. Reason: ${overrideReason!.trim().slice(0, 500)}`,
    });
    displacedIds.push(displacedId);
  }
  if (displacedIds.length > 0) meta.displacedBookingIds = displacedIds;

  logAudit({ session, action: "booking.created", entity: "Booking", entityId: booking.id, tenantId: bookingTenantId, meta });

  return NextResponse.json(booking, { status: 201 });
}

/**
 * Is an existing slot ("HH:MM", one hour long) immediately before or after
 * any requested slot?
 */
function isAdjacentSlot(existingSlot: string, requestedSlots: string[]): boolean {
  const existing = parseTimeSlot(existingSlot);
  if (existing === null) return false;
  return requestedSlots.some((rs) => {
    const requested = parseTimeSlot(rs);
    return requested !== null && Math.abs(requested - existing) === SLOT_MINUTES;
  });
}
