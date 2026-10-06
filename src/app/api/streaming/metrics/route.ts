import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { hasRole } from "@/lib/roles";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";

/** GET — aggregate streaming metrics for a tenant. TENANT_ADMIN+ only. */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  if (!hasRole(session.user.role, "TENANT_ADMIN")) {
    return jsonError("Forbidden", 403);
  }

  const flagOn = await isFeatureEnabled(tenantId, "liveStreaming");
  if (!flagOn) return NextResponse.json({});

  const [totalStreams, liveStreams, totalViewers, viewerRecords] = await Promise.all([
    prisma.streamSession.count({ where: { tenantId } }),
    prisma.streamSession.count({ where: { tenantId, status: "LIVE" } }),
    prisma.streamViewer.count({
      where: { streamSession: { tenantId } },
    }),
    prisma.streamViewer.findMany({
      where: { streamSession: { tenantId }, durationSeconds: { not: null } },
      select: { durationSeconds: true },
    }),
  ]);

  const totalWatchSeconds = viewerRecords.reduce((sum, v) => sum + (v.durationSeconds ?? 0), 0);
  const avgWatchSeconds = viewerRecords.length > 0 ? Math.round(totalWatchSeconds / viewerRecords.length) : 0;

  // Current live viewer count
  const currentViewers = await prisma.streamViewer.count({
    where: { streamSession: { tenantId, status: "LIVE" }, leftAt: null },
  });

  return NextResponse.json({
    totalStreams,
    liveStreams,
    totalViewers,
    currentViewers,
    totalWatchHours: Math.round((totalWatchSeconds / 3600) * 10) / 10,
    avgWatchSeconds,
  });
}
