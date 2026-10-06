import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail, getEffective } from "@/lib/api-utils";
import { prisma } from "@/lib/prisma";
import { hasRole, isPlatformAdmin as isPlatformAdminRole } from "@/lib/roles";

export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  // Allow real TENANT_ADMIN+ in their tenant, or PLATFORM_ADMIN cross-tenant view.
  const eff = getEffective(session);
  const isRealPlatformAdmin = isPlatformAdminRole(session.user.role);
  if (!isRealPlatformAdmin && !hasRole(eff.role, "TENANT_ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const period = sp.get("period") ?? "7d";
  const groupBy = sp.get("groupBy") ?? "eventType";
  const paramTenantId = sp.get("tenantId");

  // Compute date range
  const days = period === "90d" ? 90 : period === "30d" ? 30 : 7;
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Tenant scoping
  let tenantFilter: string | undefined;

  if (isRealPlatformAdmin && !eff.isImpersonating) {
    // Cross-tenant view; optional explicit tenant filter.
    if (paramTenantId) tenantFilter = paramTenantId;
  } else {
    tenantFilter = eff.tenantId ?? undefined;
    if (!tenantFilter) {
      return NextResponse.json({ error: "No tenant context" }, { status: 400 });
    }
  }

  const where = {
    timestamp: { gte: since },
    ...(tenantFilter ? { tenantId: tenantFilter } : {}),
  };

  // Aggregated stats
  const [totalEvents, uniqueVisitors, dailyCounts, browserBreakdown, deviceBreakdown, pwaBreakdown, topPages, featureUsage, topInteractions] =
    await Promise.all([
      // Total events
      prisma.trackingEvent.count({ where }),

      // Unique visitors (distinct fingerprints)
      prisma.trackingEvent.groupBy({
        by: ["sessionFingerprint"],
        where,
        _count: true,
      }).then((r) => r.length),

      // Daily event counts
      prisma.$queryRawUnsafe<{ day: string; count: number }[]>(
        `SELECT timestamp::date as day, COUNT(*) as count FROM "TrackingEvent" WHERE timestamp >= $1 ${tenantFilter ? `AND "tenantId" = $2` : ""} GROUP BY day ORDER BY day`,
        since.toISOString(),
        ...(tenantFilter ? [tenantFilter] : []),
      ),

      // Browser breakdown
      prisma.trackingEvent.groupBy({
        by: ["browserFamily"],
        where,
        _count: true,
        orderBy: { _count: { browserFamily: "desc" } },
        take: 10,
      }),

      // Device breakdown
      prisma.trackingEvent.groupBy({
        by: ["deviceType"],
        where,
        _count: true,
        orderBy: { _count: { deviceType: "desc" } },
      }),

      // PWA vs browser
      prisma.trackingEvent.groupBy({
        by: ["isPWA"],
        where,
        _count: true,
      }),

      // Top pages
      prisma.trackingEvent.groupBy({
        by: ["path"],
        where: { ...where, eventType: "PAGE_VIEW" },
        _count: true,
        orderBy: { _count: { path: "desc" } },
        take: 20,
      }),

      // Feature usage
      prisma.trackingEvent.groupBy({
        by: ["action"],
        where: { ...where, eventType: "FEATURE_USE" },
        _count: true,
        orderBy: { _count: { action: "desc" } },
        take: 20,
      }),

      // Top interactions
      prisma.trackingEvent.groupBy({
        by: ["action"],
        where: { ...where, eventType: "INTERACTION" },
        _count: true,
        orderBy: { _count: { action: "desc" } },
        take: 20,
      }),
    ]);

  return NextResponse.json({
    period,
    totalEvents,
    uniqueVisitors,
    dailyCounts: dailyCounts.map((r) => ({ day: r.day, count: Number(r.count) })),
    browsers: browserBreakdown.map((r) => ({ name: r.browserFamily, count: r._count })),
    devices: deviceBreakdown.map((r) => ({ name: r.deviceType, count: r._count })),
    pwa: pwaBreakdown.map((r) => ({ isPWA: r.isPWA, count: r._count })),
    topPages: topPages.map((r) => ({ path: r.path, count: r._count })),
    featureUsage: featureUsage.map((r) => ({ action: r.action, count: r._count })),
    topInteractions: topInteractions.map((r) => ({ action: r.action, count: r._count })),
  });
}
