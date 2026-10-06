import { NextRequest, NextResponse } from "next/server";
import { MaintenanceActivityType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { hasRole } from "@/lib/roles";
import { logAudit } from "@/lib/audit";

/**
 * Maintenance activity history.
 *
 * GET  /api/maintenance/history — list. Filters: ?greenId=&activityType=&since=&until=&limit=
 * POST /api/maintenance/history — record an activity.
 *
 * MAINTENANCE+ for both. The Triage Agent reads this history to ground its
 * recommendations (e.g. "you mowed Green 4 yesterday, deprioritise").
 */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  if (!hasRole(getEffective(session).role, "MAINTENANCE")) return jsonError("Forbidden", 403);

  const { searchParams } = new URL(req.url);
  const greenId = searchParams.get("greenId");
  const activityType = searchParams.get("activityType") as MaintenanceActivityType | null;
  const since = searchParams.get("since");
  const until = searchParams.get("until");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100", 10) || 100, 500);

  const where: Record<string, unknown> = { tenantId };
  if (greenId) where.greenId = greenId;
  if (activityType) where.activityType = activityType;
  if (since || until) {
    where.performedAt = {
      ...(since ? { gte: new Date(since) } : {}),
      ...(until ? { lte: new Date(until) } : {}),
    };
  }

  const entries = await prisma.maintenanceHistory.findMany({
    where,
    orderBy: { performedAt: "desc" },
    take: limit,
    include: {
      green: { select: { id: true, name: true } },
      performedBy: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({ entries });
}

export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  if (!hasRole(getEffective(session).role, "MAINTENANCE")) return jsonError("Forbidden", 403);

  const body = await req.json().catch(() => ({}));
  const activityType = body.activityType as MaintenanceActivityType;
  if (!activityType || !Object.values(MaintenanceActivityType).includes(activityType)) {
    return jsonError("Valid activityType required", 400);
  }
  const performedAt = body.performedAt ? new Date(body.performedAt) : new Date();
  if (isNaN(performedAt.getTime())) return jsonError("Invalid performedAt", 400);

  // Validate green belongs to tenant if provided.
  if (body.greenId) {
    const green = await prisma.green.findUnique({ where: { id: body.greenId }, select: { tenantId: true } });
    if (!green || green.tenantId !== tenantId) return jsonError("Invalid greenId", 400);
  }

  const entry = await prisma.maintenanceHistory.create({
    data: {
      tenantId,
      greenId: body.greenId ?? null,
      activityType,
      description: typeof body.description === "string" ? body.description : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      performedAt,
      performedById: session.user.id,
    },
  });

  logAudit({
    session, action: "maintenance.history_created", entity: "MaintenanceHistory",
    entityId: entry.id, tenantId,
    meta: { activityType, greenId: body.greenId },
  });

  return NextResponse.json({ entry }, { status: 201 });
}
