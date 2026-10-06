import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective } from "@/lib/api-utils";
import { hasRole, isPlatformAdmin as isPlatformAdminRole } from "@/lib/roles";
import type { Prisma } from "@prisma/client";

/** List audit events — scoped by role.
 *
 *  - Real PLATFORM_ADMIN (NOT impersonating): sees all events platform-wide; may filter by `?tenantId=`.
 *  - PLATFORM_ADMIN currently impersonating: scoped to the impersonated tenant.
 *  - TENANT_ADMIN: scoped to own tenant.
 *  - Everyone else: only their own events.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const params = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt(params.get("limit") ?? "50", 10)));
  const skip = (page - 1) * limit;

  const where: Prisma.AuditEventWhereInput = {};

  const eff = getEffective(session);
  const isRealPlatformAdmin = isPlatformAdminRole(session.user.role);
  const canSeeTenant = hasRole(eff.role, "TENANT_ADMIN");

  if (isRealPlatformAdmin && !eff.isImpersonating) {
    // Cross-tenant view; optional explicit tenant filter.
    const tenantId = params.get("tenantId");
    if (tenantId) where.tenantId = tenantId;
  } else if (canSeeTenant && eff.tenantId) {
    where.tenantId = eff.tenantId;
  } else {
    // Regular users see only their own events
    where.actorId = session.user.id;
  }

  // Filters
  const action = params.get("action");
  if (action) where.action = { startsWith: action };

  const entity = params.get("entity");
  if (entity) where.entity = entity;

  const from = params.get("from");
  const to = params.get("to");
  if (from || to) {
    where.timestamp = {};
    if (from) where.timestamp.gte = new Date(from);
    if (to) where.timestamp.lte = new Date(to);
  }

  const actorId = params.get("actorId");
  if (actorId && (isRealPlatformAdmin || canSeeTenant)) where.actorId = actorId;

  const piiAccess = params.get("piiAccess");
  if (piiAccess === "true") where.piiAccess = true;

  const [events, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      include: {
        actor: { select: { id: true, name: true, email: true, role: true } },
        tenant: { select: { id: true, name: true } },
      },
      orderBy: { timestamp: "desc" },
      skip,
      take: limit,
    }),
    prisma.auditEvent.count({ where }),
  ]);

  // Resolve impersonated-tenant names for display
  const actingTenantIds = Array.from(
    new Set(events.map((e) => e.actingAsTenantId).filter((v): v is string => Boolean(v))),
  );
  const actingTenants = actingTenantIds.length
    ? await prisma.tenant.findMany({
        where: { id: { in: actingTenantIds } },
        select: { id: true, name: true, slug: true },
      })
    : [];
  const tenantMap = new Map(actingTenants.map((t) => [t.id, t]));
  const enriched = events.map((e) => ({
    ...e,
    actingAsTenant: e.actingAsTenantId ? tenantMap.get(e.actingAsTenantId) ?? null : null,
  }));

  return NextResponse.json({ events: enriched, total, page, limit });
}
