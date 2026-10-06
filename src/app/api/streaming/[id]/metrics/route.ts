import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { hasRole } from "@/lib/roles";
import { resolveTenantId } from "@/lib/tenant";

type RouteContext = { params: Promise<{ id: string }> };

/** GET — per-stream metrics. TENANT_ADMIN+ only. */
export async function GET(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  if (!hasRole(session.user.role, "TENANT_ADMIN")) {
    return jsonError("Forbidden", 403);
  }

  const stream = await prisma.streamSession.findFirst({ where: { id, tenantId } });
  if (!stream) return jsonError("Stream not found", 404);

  const viewers = await prisma.streamViewer.findMany({
    where: { streamSessionId: id },
    select: {
      id: true,
      userId: true,
      accessMethod: true,
      joinedAt: true,
      leftAt: true,
      durationSeconds: true,
      user: { select: { name: true } },
    },
    orderBy: { joinedAt: "asc" },
  });

  const currentViewers = viewers.filter((v) => !v.leftAt).length;
  const uniqueViewers = new Set(viewers.map((v) => v.userId ?? v.id)).size;
  const completedViewers = viewers.filter((v) => v.durationSeconds != null);
  const avgDuration = completedViewers.length > 0
    ? Math.round(completedViewers.reduce((sum, v) => sum + v.durationSeconds!, 0) / completedViewers.length)
    : 0;
  const peakConcurrent = viewers.length; // Simplified — real implementation would compute time-series overlap

  return NextResponse.json({
    streamId: id,
    currentViewers,
    totalViewers: viewers.length,
    uniqueViewers,
    avgDurationSeconds: avgDuration,
    peakConcurrent,
    viewers,
  });
}
