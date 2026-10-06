import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { hasRole } from "@/lib/roles";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";
import { logAudit } from "@/lib/audit";

const VALID_CATEGORIES = ["SOCIAL", "COMPETITION", "LEAGUE", "OPEN_DAY", "TOURNAMENT", "OTHER"] as const;
const VALID_FORMATS = ["KNOCKOUT", "AMERICAN", "LEAGUE_FORMAT", "CANADIAN", "OTHER_FORMAT"] as const;
const VALID_PLAYER_COUNTS = ["SINGLES", "PAIRS", "TRIPLES", "FOURS"] as const;
const VALID_VISIBILITIES = ["MEMBERS_ONLY", "PUBLIC"] as const;

/** GET — list events for a tenant.
 *  Users see only PUBLISHED events. TENANT_ADMIN sees all (including DRAFT).
 *  If eventsShowExternal is enabled, also returns cross-tenant PUBLIC events. */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const flagOn = await isFeatureEnabled(tenantId, "events");
  if (!flagOn) return NextResponse.json([]);

  const isAdmin = hasRole(getEffective(session).role, "TENANT_ADMIN");

  const events = await prisma.event.findMany({
    where: {
      tenantId,
      ...(!isAdmin ? { status: "PUBLISHED" } : {}),
    },
    include: {
      tenant: { select: { id: true, name: true, slug: true } },
      createdBy: { select: { id: true, name: true } },
      updatedBy: { select: { id: true, name: true } },
    },
    orderBy: { date: "asc" },
  });

  // Cross-tenant public events
  let externalEvents: typeof events = [];
  const showExternal = await isFeatureEnabled(tenantId, "eventsShowExternal");
  if (showExternal) {
    // Find tenants that share externally
    const sharingFlags = await prisma.featureFlag.findMany({
      where: { key: "eventsShareExternal", enabled: true, tenantId: { not: tenantId } },
      select: { tenantId: true },
    });
    const sharingTenantIds = sharingFlags.map((f) => f.tenantId);

    if (sharingTenantIds.length > 0) {
      externalEvents = await prisma.event.findMany({
        where: {
          tenantId: { in: sharingTenantIds },
          status: "PUBLISHED",
          visibility: "PUBLIC",
        },
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
          createdBy: { select: { id: true, name: true } },
          updatedBy: { select: { id: true, name: true } },
        },
        orderBy: { date: "asc" },
      });
    }
  }

  return NextResponse.json({ events, externalEvents });
}

/** POST — create a new event. TENANT_ADMIN+ only. */
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  if (!hasRole(getEffective(session).role, "TENANT_ADMIN")) {
    return jsonError("Forbidden", 403);
  }

  const flagOn = await isFeatureEnabled(tenantId, "events");
  if (!flagOn) return jsonError("Events feature is not enabled for this tenant", 403);

  const body = await req.json();
  const {
    title, description, category, format, playerCount,
    date, startTime, endTime, location, capacity, entryFee,
    currency, imageUrl, contactName, contactEmail, contactPhone,
    visibility,
  } = body;

  if (!title || !description || !date || !startTime || !category) {
    return jsonError("title, description, date, startTime, and category are required");
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return jsonError(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`);
  }
  if (format && !VALID_FORMATS.includes(format)) {
    return jsonError(`Invalid format. Must be one of: ${VALID_FORMATS.join(", ")}`);
  }
  if (playerCount && !VALID_PLAYER_COUNTS.includes(playerCount)) {
    return jsonError(`Invalid playerCount. Must be one of: ${VALID_PLAYER_COUNTS.join(", ")}`);
  }
  if (visibility && !VALID_VISIBILITIES.includes(visibility)) {
    return jsonError(`Invalid visibility. Must be one of: ${VALID_VISIBILITIES.join(", ")}`);
  }
  if (endTime && startTime && endTime <= startTime) {
    return jsonError("End time must be after start time");
  }

  const event = await prisma.event.create({
    data: {
      tenantId,
      title,
      description,
      category,
      format: format || null,
      playerCount: playerCount || null,
      date,
      startTime,
      endTime: endTime || null,
      location: location || null,
      capacity: capacity != null ? Number(capacity) : null,
      entryFee: entryFee != null ? Number(entryFee) : null,
      currency: currency || "GBP",
      imageUrl: imageUrl || null,
      contactName: contactName || null,
      contactEmail: contactEmail || null,
      contactPhone: contactPhone || null,
      visibility: visibility || "MEMBERS_ONLY",
      createdById: session.user.id,
    },
  });

  logAudit({
    session,
    action: "event.created",
    entity: "Event",
    entityId: event.id,
    tenantId,
    meta: { title, category, date },
  });

  return NextResponse.json(event, { status: 201 });
}
