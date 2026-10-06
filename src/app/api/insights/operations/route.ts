import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail, assertEffectiveRoleOrFail } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const enabled = await isFeatureEnabled(tenantId, "businessInsights");
  if (!enabled) {
    return NextResponse.json({ error: "Feature not enabled" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const period = sp.get("period") ?? "30d";
  const days = period === "90d" ? 90 : period === "30d" ? 30 : 7;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceISO = since.toISOString().slice(0, 10);

  const [
    totalTasks,
    closedTasks,
    tasksByCategory,
    tasksByPriority,
    avgTimeToClose,
    totalEvents,
    publishedEvents,
    eventsByCategory,
    upcomingEvents,
  ] = await Promise.all([
    // Total tasks in period
    prisma.maintenanceTask.count({
      where: { tenantId, createdAt: { gte: since } },
    }),

    // Closed tasks in period
    prisma.maintenanceTask.count({
      where: { tenantId, createdAt: { gte: since }, status: "CLOSED" },
    }),

    // Tasks by category
    prisma.maintenanceTask.groupBy({
      by: ["category"],
      where: { tenantId, createdAt: { gte: since } },
      _count: true,
      orderBy: { _count: { category: "desc" } },
    }),

    // Tasks by priority
    prisma.maintenanceTask.groupBy({
      by: ["priority"],
      where: { tenantId, createdAt: { gte: since } },
      _count: true,
      orderBy: { _count: { priority: "desc" } },
    }),

    // Average time to close (in days) for tasks closed in the period
    prisma.$queryRawUnsafe<{ avg_days: number }[]>(
      `SELECT COALESCE(
         AVG(EXTRACT(EPOCH FROM ("updatedAt" - "createdAt")) / 86400),
         0
       )::float as avg_days
       FROM "MaintenanceTask"
       WHERE "tenantId" = $1
         AND "createdAt" >= $2
         AND status = 'CLOSED'`,
      tenantId,
      since,
    ),

    // Total events in period
    prisma.event.count({
      where: { tenantId, date: { gte: sinceISO } },
    }),

    // Published events in period
    prisma.event.count({
      where: { tenantId, date: { gte: sinceISO }, status: "PUBLISHED" },
    }),

    // Events by category
    prisma.event.groupBy({
      by: ["category"],
      where: { tenantId, date: { gte: sinceISO } },
      _count: true,
      orderBy: { _count: { category: "desc" } },
    }),

    // Upcoming events (future dates)
    prisma.event.count({
      where: {
        tenantId,
        date: { gte: new Date().toISOString().slice(0, 10) },
        status: "PUBLISHED",
      },
    }),
  ]);

  const completionRate = totalTasks > 0
    ? Math.round((closedTasks / totalTasks) * 100)
    : 0;

  return NextResponse.json({
    period,
    tasks: {
      total: totalTasks,
      closed: closedTasks,
      completionRate,
      avgDaysToClose: Math.round((avgTimeToClose[0]?.avg_days ?? 0) * 10) / 10,
      byCategory: tasksByCategory.map((r) => ({
        category: r.category,
        count: r._count,
      })),
      byPriority: tasksByPriority.map((r) => ({
        priority: r.priority,
        count: r._count,
      })),
    },
    events: {
      total: totalEvents,
      published: publishedEvents,
      upcoming: upcomingEvents,
      byCategory: eventsByCategory.map((r) => ({
        category: r.category,
        count: r._count,
      })),
    },
  });
}
