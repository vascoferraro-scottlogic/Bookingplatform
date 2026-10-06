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

/** Valid status transitions: DRAFT ↔ PUBLISHED */
const STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["PUBLISHED"],
  PUBLISHED: ["DRAFT"],
};

type Params = { params: Promise<{ id: string }> };

/** GET — single event by ID (tenant-scoped). */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const event = await prisma.event.findFirst({
    where: { id, tenantId },
    include: {
      tenant: { select: { id: true, name: true, slug: true } },
      createdBy: { select: { id: true, name: true } },
      updatedBy: { select: { id: true, name: true } },
    },
  });

  if (!event) return jsonError("Not found", 404);
  return NextResponse.json(event);
}

/** PATCH — update fields, change status. TENANT_ADMIN+ only. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  if (!hasRole(getEffective(session).role, "TENANT_ADMIN")) {
    return jsonError("Forbidden", 403);
  }

  const flagOn = await isFeatureEnabled(tenantId, "events");
  if (!flagOn) return jsonError("Events feature is not enabled for this tenant", 403);

  const existing = await prisma.event.findFirst({ where: { id, tenantId } });
  if (!existing) return jsonError("Not found", 404);

  const body = await req.json();
  const {
    title, description, category, format, playerCount,
    date, startTime, endTime, location, capacity, entryFee,
    currency, imageUrl, contactName, contactEmail, contactPhone,
    visibility, status,
  } = body;

  // Validate status transition if requested
  if (status && status !== existing.status) {
    const allowed = STATUS_TRANSITIONS[existing.status];
    if (!allowed || !allowed.includes(status)) {
      return jsonError(`Cannot transition from ${existing.status} to ${status}`);
    }
  }

  // Validate enums if provided
  if (category && !VALID_CATEGORIES.includes(category)) {
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
  const effectiveStart = startTime ?? existing.startTime;
  const effectiveEnd = endTime !== undefined ? endTime : existing.endTime;
  if (effectiveEnd && effectiveStart && effectiveEnd <= effectiveStart) {
    return jsonError("End time must be after start time");
  }

  const event = await prisma.event.update({
    where: { id },
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(category !== undefined && { category }),
      ...(format !== undefined && { format: format || null }),
      ...(playerCount !== undefined && { playerCount: playerCount || null }),
      ...(date !== undefined && { date }),
      ...(startTime !== undefined && { startTime }),
      ...(endTime !== undefined && { endTime: endTime || null }),
      ...(location !== undefined && { location: location || null }),
      ...(capacity !== undefined && { capacity: capacity != null ? Number(capacity) : null }),
      ...(entryFee !== undefined && { entryFee: entryFee != null ? Number(entryFee) : null }),
      ...(currency !== undefined && { currency }),
      ...(imageUrl !== undefined && { imageUrl: imageUrl || null }),
      ...(contactName !== undefined && { contactName: contactName || null }),
      ...(contactEmail !== undefined && { contactEmail: contactEmail || null }),
      ...(contactPhone !== undefined && { contactPhone: contactPhone || null }),
      ...(visibility !== undefined && { visibility }),
      ...(status !== undefined && { status }),
      updatedById: session.user.id,
    },
  });

  const action = status === "PUBLISHED"
    ? "event.published"
    : status === "DRAFT"
      ? "event.unpublished"
      : "event.updated";

  logAudit({
    session,
    action,
    entity: "Event",
    entityId: event.id,
    tenantId,
    meta: {
      title: event.title,
      ...(status && { from: existing.status, to: status }),
    },
  });

  return NextResponse.json(event);
}

/** DELETE — hard-delete drafts, unpublish (set DRAFT) anything else. TENANT_ADMIN+ only. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  if (!hasRole(getEffective(session).role, "TENANT_ADMIN")) {
    return jsonError("Forbidden", 403);
  }

  const existing = await prisma.event.findFirst({ where: { id, tenantId } });
  if (!existing) return jsonError("Not found", 404);

  if (existing.status === "DRAFT") {
    await prisma.event.delete({ where: { id } });
    logAudit({ session, action: "event.deleted", entity: "Event", entityId: id, tenantId });
    return NextResponse.json({ deleted: true });
  }

  // Non-draft: unpublish instead of hard delete
  const event = await prisma.event.update({
    where: { id },
    data: { status: "DRAFT", updatedById: session.user.id },
  });

  logAudit({ session, action: "event.unpublished", entity: "Event", entityId: id, tenantId });
  return NextResponse.json(event);
}
