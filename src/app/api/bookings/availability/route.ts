import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { DEFAULT_OPENING_TIME, DEFAULT_CLOSING_TIME } from "@/lib/time-slots";
import { isGreenOpenOn, seasonWindowForDate } from "@/lib/season";

/** Get availability grid: all rinks with booking status for a given date. */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const date = req.nextUrl.searchParams.get("date");
  if (!date) return jsonError("date query param required");

  const [tenant, greens] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { openingTime: true, closingTime: true, timezone: true },
    }),
    prisma.green.findMany({
      where: { tenantId, archivedAt: null },
      include: {
        seasons: { select: { year: true, startDate: true, endDate: true } },
        rinks: {
          where: { archivedAt: null },
          include: {
            bookingSlots: {
              where: {
                booking: {
                  date,
                  status: { in: ["RESERVED", "CONFIRMED"] },
                },
              },
              select: { timeSlot: true, playerName: true, bookingId: true },
            },
          },
        },
      },
    }),
  ]);

  // Annotate each green with per-green season info for the requested date
  const annotatedGreens = greens.map((g) => {
    const open = isGreenOpenOn(g, date, tenant?.timezone ?? undefined);
    const window = seasonWindowForDate(g, date, tenant?.timezone ?? undefined);
    return {
      ...g,
      season: {
        open,
        allWeather: g.allWeather,
        window,
      },
    };
  });

  return NextResponse.json({
    config: {
      openingTime: tenant?.openingTime ?? DEFAULT_OPENING_TIME,
      closingTime: tenant?.closingTime ?? DEFAULT_CLOSING_TIME,
    },
    greens: annotatedGreens,
  });
}
