import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** GET — aggregate public events across all tenants with `publicEvents` enabled.
 *  No auth required.
 *  Query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD&category=SOCIAL */
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from") ?? new Date().toISOString().slice(0, 10);
  const to = req.nextUrl.searchParams.get("to");
  const category = req.nextUrl.searchParams.get("category");

  // Find tenants that have opted in to public events
  const publicFlags = await prisma.featureFlag.findMany({
    where: { key: "publicEvents", enabled: true },
    select: { tenantId: true },
  });

  const tenantIds = publicFlags.map((f) => f.tenantId);
  if (tenantIds.length === 0) return NextResponse.json([]);

  // Only include events from active tenants
  const events = await prisma.event.findMany({
    where: {
      tenantId: { in: tenantIds },
      status: "PUBLISHED",
      visibility: "PUBLIC",
      date: { gte: from, ...(to ? { lte: to } : {}) },
      ...(category ? { category: category as any } : {}),
      tenant: { active: true },
    },
    include: {
      tenant: { select: { name: true, slug: true, brandColor: true } },
    },
    orderBy: { date: "asc" },
  });

  return NextResponse.json(events);
}
