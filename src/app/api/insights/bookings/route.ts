import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail, getEffective, assertEffectiveRoleOrFail } from "@/lib/api-utils";
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
  const period = sp.get("period") ?? "7d";
  const days = period === "90d" ? 90 : period === "30d" ? 30 : 7;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceISO = since.toISOString().slice(0, 10); // "YYYY-MM-DD"

  const [
    totalBookings,
    confirmedBookings,
    cancelledBookings,
    dailyBookings,
    revenueByDay,
    totalRevenue,
    peakHours,
    topBookers,
    greenUtilisation,
  ] = await Promise.all([
    // Total bookings in period
    prisma.booking.count({
      where: { tenantId, date: { gte: sinceISO } },
    }),

    // Confirmed bookings
    prisma.booking.count({
      where: { tenantId, date: { gte: sinceISO }, status: "CONFIRMED" },
    }),

    // Cancelled bookings
    prisma.booking.count({
      where: { tenantId, date: { gte: sinceISO }, status: "CANCELLED" },
    }),

    // Daily booking counts
    prisma.$queryRawUnsafe<{ day: string; count: bigint }[]>(
      `SELECT date as day, COUNT(*)::bigint as count
       FROM "Booking"
       WHERE "tenantId" = $1 AND date >= $2
       GROUP BY date ORDER BY date`,
      tenantId,
      sinceISO,
    ),

    // Revenue by day (PAID payments only)
    prisma.$queryRawUnsafe<{ day: string; total: bigint }[]>(
      `SELECT b.date as day, COALESCE(SUM(bp.amount), 0)::bigint as total
       FROM "BookingPayment" bp
       JOIN "Booking" b ON b.id = bp."bookingId"
       WHERE b."tenantId" = $1 AND b.date >= $2 AND bp.status = 'PAID'
       GROUP BY b.date ORDER BY b.date`,
      tenantId,
      sinceISO,
    ),

    // Total revenue in period
    prisma.$queryRawUnsafe<{ total: bigint }[]>(
      `SELECT COALESCE(SUM(bp.amount), 0)::bigint as total
       FROM "BookingPayment" bp
       JOIN "Booking" b ON b.id = bp."bookingId"
       WHERE b."tenantId" = $1 AND b.date >= $2 AND bp.status = 'PAID'`,
      tenantId,
      sinceISO,
    ),

    // Peak hours: count of booking slots by timeSlot and day-of-week
    prisma.$queryRawUnsafe<{ dow: number; time_slot: string; count: bigint }[]>(
      `SELECT EXTRACT(DOW FROM b.date::date)::int as dow,
              bs."timeSlot" as time_slot,
              COUNT(*)::bigint as count
       FROM "BookingSlot" bs
       JOIN "Booking" b ON b.id = bs."bookingId"
       WHERE b."tenantId" = $1 AND b.date >= $2
       GROUP BY dow, bs."timeSlot"
       ORDER BY count DESC`,
      tenantId,
      sinceISO,
    ),

    // Top 10 bookers
    prisma.$queryRawUnsafe<{ user_id: string; user_name: string; count: bigint }[]>(
      `SELECT b."userId" as user_id,
              u.name as user_name,
              COUNT(*)::bigint as count
       FROM "Booking" b
       JOIN "User" u ON u.id = b."userId"
       WHERE b."tenantId" = $1 AND b.date >= $2
       GROUP BY b."userId", u.name
       ORDER BY count DESC
       LIMIT 10`,
      tenantId,
      sinceISO,
    ),

    // Slots per green (for utilisation)
    prisma.$queryRawUnsafe<{ green_name: string; count: bigint }[]>(
      `SELECT COALESCE(bs."greenName", r.name) as green_name,
              COUNT(*)::bigint as count
       FROM "BookingSlot" bs
       JOIN "Booking" b ON b.id = bs."bookingId"
       JOIN "Rink" r ON r.id = bs."rinkId"
       WHERE b."tenantId" = $1 AND b.date >= $2
       GROUP BY green_name
       ORDER BY count DESC`,
      tenantId,
      sinceISO,
    ),
  ]);

  const cancellationRate =
    totalBookings > 0
      ? Math.round((cancelledBookings / totalBookings) * 100)
      : 0;

  return NextResponse.json({
    period,
    totalBookings,
    confirmedBookings,
    cancelledBookings,
    cancellationRate,
    totalRevenue: Number(totalRevenue[0]?.total ?? 0),
    dailyBookings: dailyBookings.map((r) => ({
      day: r.day,
      count: Number(r.count),
    })),
    revenueByDay: revenueByDay.map((r) => ({
      day: r.day,
      total: Number(r.total),
    })),
    peakHours: peakHours.map((r) => ({
      dow: r.dow,
      timeSlot: r.time_slot,
      count: Number(r.count),
    })),
    topBookers: topBookers.map((r) => ({
      userId: r.user_id,
      name: r.user_name,
      count: Number(r.count),
    })),
    greenUtilisation: greenUtilisation.map((r) => ({
      greenName: r.green_name,
      count: Number(r.count),
    })),
  });
}
