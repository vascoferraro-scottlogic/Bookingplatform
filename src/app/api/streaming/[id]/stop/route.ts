import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { hasRole } from "@/lib/roles";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { clearSignals } from "@/lib/streaming";

type RouteContext = { params: Promise<{ id: string }> };

/** POST — stop a stream (LIVE → ENDED). TENANT_ADMIN+ only. */
export async function POST(req: NextRequest, context: RouteContext) {
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

  if (stream.status !== "LIVE") {
    return jsonError(`Cannot stop stream in ${stream.status} state`, 400);
  }

  const now = new Date();

  // End all active viewer sessions
  const activeViewers = await prisma.streamViewer.findMany({
    where: { streamSessionId: id, leftAt: null },
  });

  for (const viewer of activeViewers) {
    const duration = Math.round((now.getTime() - viewer.joinedAt.getTime()) / 1000);
    await prisma.streamViewer.update({
      where: { id: viewer.id },
      data: { leftAt: now, durationSeconds: duration },
    });
  }

  const updated = await prisma.streamSession.update({
    where: { id },
    data: { status: "ENDED", endedAt: now },
  });

  clearSignals(id);

  logAudit({
    session,
    action: "streaming.stopped",
    entity: "StreamSession",
    entityId: id,
    meta: { title: stream.title, viewersEnded: activeViewers.length },
  });

  return NextResponse.json(updated);
}
