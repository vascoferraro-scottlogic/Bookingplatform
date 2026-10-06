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

  const [
    totalMembers,
    newMembers,
    membersByWeek,
    roleBreakdown,
    activeBookers,
    activeMessagers,
    dormantMembers,
  ] = await Promise.all([
    // Total users in this tenant (excluding suspended)
    prisma.user.count({
      where: { tenantId, suspended: false },
    }),

    // New members in the period
    prisma.user.count({
      where: { tenantId, suspended: false, createdAt: { gte: since } },
    }),

    // New members grouped by week
    prisma.$queryRawUnsafe<{ week: string; count: bigint }[]>(
      `SELECT date_trunc('week', "createdAt")::date::text as week,
              COUNT(*)::bigint as count
       FROM "User"
       WHERE "tenantId" = $1 AND suspended = false AND "createdAt" >= $2
       GROUP BY week ORDER BY week`,
      tenantId,
      since,
    ),

    // Role breakdown
    prisma.user.groupBy({
      by: ["role"],
      where: { tenantId, suspended: false },
      _count: true,
    }),

    // Users who booked in the period
    prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(DISTINCT "userId")::bigint as count
       FROM "Booking"
       WHERE "tenantId" = $1 AND date >= $2`,
      tenantId,
      since.toISOString().slice(0, 10),
    ),

    // Users who sent a message in the period
    prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(DISTINCT "userId")::bigint as count
       FROM "Message"
       WHERE "tenantId" = $1 AND "createdAt" >= $2`,
      tenantId,
      since,
    ),

    // Dormant members: users with no booking AND no message in the last 90 days
    prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint as count
       FROM "User" u
       WHERE u."tenantId" = $1
         AND u.suspended = false
         AND u.role != 'PLATFORM_ADMIN'
         AND NOT EXISTS (
           SELECT 1 FROM "Booking" b
           WHERE b."userId" = u.id AND b.date >= $2
         )
         AND NOT EXISTS (
           SELECT 1 FROM "Message" m
           WHERE m."userId" = u.id AND m."createdAt" >= $3
         )`,
      tenantId,
      new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10),
      new Date(Date.now() - 90 * 86400000),
    ),
  ]);

  // Top 10 most active members (bookings + messages combined)
  const topActive = await prisma.$queryRawUnsafe<
    { user_id: string; user_name: string; booking_count: bigint; message_count: bigint; total: bigint }[]
  >(
    `SELECT u.id as user_id,
            u.name as user_name,
            COALESCE(b.cnt, 0)::bigint as booking_count,
            COALESCE(m.cnt, 0)::bigint as message_count,
            (COALESCE(b.cnt, 0) + COALESCE(m.cnt, 0))::bigint as total
     FROM "User" u
     LEFT JOIN (
       SELECT "userId", COUNT(*) as cnt
       FROM "Booking"
       WHERE "tenantId" = $1 AND date >= $3
       GROUP BY "userId"
     ) b ON b."userId" = u.id
     LEFT JOIN (
       SELECT "userId", COUNT(*) as cnt
       FROM "Message"
       WHERE "tenantId" = $1 AND "createdAt" >= $2
       GROUP BY "userId"
     ) m ON m."userId" = u.id
     WHERE u."tenantId" = $1 AND u.suspended = false
       AND (COALESCE(b.cnt, 0) + COALESCE(m.cnt, 0)) > 0
     ORDER BY total DESC
     LIMIT 10`,
    tenantId,
    since,
    since.toISOString().slice(0, 10),
  );

  return NextResponse.json({
    period,
    totalMembers,
    newMembers,
    membersByWeek: membersByWeek.map((r) => ({
      week: r.week,
      count: Number(r.count),
    })),
    roleBreakdown: roleBreakdown.map((r) => ({
      role: r.role,
      count: r._count,
    })),
    activeBookers: Number(activeBookers[0]?.count ?? 0),
    activeMessagers: Number(activeMessagers[0]?.count ?? 0),
    dormantMembers: Number(dormantMembers[0]?.count ?? 0),
    topActive: topActive.map((r) => ({
      userId: r.user_id,
      name: r.user_name,
      bookings: Number(r.booking_count),
      messages: Number(r.message_count),
      total: Number(r.total),
    })),
  });
}
