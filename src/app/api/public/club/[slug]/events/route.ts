import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/features";
import { jsonError } from "@/lib/api-utils";

type Params = { params: Promise<{ slug: string }> };

/** GET — public published events for a club. No auth required.
 *  Gated by `publicEvents` feature flag.
 *  Query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD */
export async function GET(req: NextRequest, { params }: Params) {
  const { slug } = await params;

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, name: true, active: true },
  });

  if (!tenant || !tenant.active) {
    return jsonError("Not found", 404);
  }

  const flagOn = await isFeatureEnabled(tenant.id, "publicEvents");
  if (!flagOn) return NextResponse.json([]);

  const from = req.nextUrl.searchParams.get("from") ?? new Date().toISOString().slice(0, 10);
  const to = req.nextUrl.searchParams.get("to");

  const events = await prisma.event.findMany({
    where: {
      tenantId: tenant.id,
      status: "PUBLISHED",
      visibility: "PUBLIC",
      date: { gte: from, ...(to ? { lte: to } : {}) },
    },
    orderBy: { date: "asc" },
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      format: true,
      playerCount: true,
      date: true,
      startTime: true,
      endTime: true,
      location: true,
      capacity: true,
      entryFee: true,
      currency: true,
      imageUrl: true,
      visibility: true,
    },
  });

  return NextResponse.json(events);
}
