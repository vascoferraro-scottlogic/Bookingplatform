import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/features";
import { jsonError } from "@/lib/api-utils";
import { isGreenOpenOn, seasonWindowForDate } from "@/lib/season";

type Params = { params: Promise<{ slug: string }> };

/** GET — public availability grid for a club. No auth required.
 *  Gated by `publicAvailability` feature flag.
 *  Returns greens/rinks with slot status (free vs booked) — no user data.
 *  Query param: ?date=YYYY-MM-DD */
export async function GET(req: NextRequest, { params }: Params) {
  const { slug } = await params;

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, active: true, openingTime: true, closingTime: true },
  });

  if (!tenant || !tenant.active) {
    return jsonError("Not found", 404);
  }

  const flagOn = await isFeatureEnabled(tenant.id, "publicAvailability");
  if (!flagOn) return jsonError("Not available", 404);

  const date = req.nextUrl.searchParams.get("date");
  if (!date) return jsonError("date query param required");

  const greens = await prisma.green.findMany({
    where: { tenantId: tenant.id },
    include: {
      seasons: { select: { year: true, startDate: true, endDate: true } },
      rinks: {
        include: {
          bookingSlots: {
            where: {
              booking: {
                date,
                status: { in: ["APPROVED", "RESERVED", "CONFIRMED"] },
              },
            },
            select: { timeSlot: true },
          },
        },
      },
    },
  });

  // Strip down to just slot status — no user data, no booking IDs
  const sanitised = greens.map((g) => ({
    id: g.id,
    name: g.name,
    season: {
      open: isGreenOpenOn(g, date),
      allWeather: g.allWeather,
      window: seasonWindowForDate(g, date),
    },
    rinks: g.rinks.map((r) => ({
      id: r.id,
      name: r.name,
      bookedSlots: r.bookingSlots.map((s) => s.timeSlot),
    })),
  }));

  return NextResponse.json({
    config: {
      openingTime: tenant.openingTime,
      closingTime: tenant.closingTime,
    },
    greens: sanitised,
  });
}
