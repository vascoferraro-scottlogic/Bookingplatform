import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/api-utils";
import { isFeatureEnabled } from "@/lib/features";

type RouteContext = { params: Promise<{ slug: string }> };

/** GET — list PUBLIC + LIVE streams for a club. No auth required. */
export async function GET(req: NextRequest, context: RouteContext) {
  const { slug } = await context.params;

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) return jsonError("Club not found", 404);

  const flagOn = await isFeatureEnabled(tenant.id, "liveStreaming");
  if (!flagOn) return NextResponse.json([]);

  const streams = await prisma.streamSession.findMany({
    where: {
      tenantId: tenant.id,
      status: "LIVE",
      visibility: "PUBLIC",
    },
    include: {
      rink: { include: { green: { select: { name: true } } } },
      event: { select: { id: true, title: true } },
      _count: { select: { viewers: { where: { leftAt: null } } } },
    },
    orderBy: { startedAt: "desc" },
  });

  return NextResponse.json({
    club: { name: tenant.name, slug: tenant.slug },
    streams,
  });
}
