import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { hasRole } from "@/lib/roles";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { canStartStream, clearSignals } from "@/lib/streaming";
import { createNotification } from "@/lib/notifications";
import { sendToUsers } from "@/lib/sse-connections";

type RouteContext = { params: Promise<{ id: string }> };

/** POST — start a stream (IDLE → LIVE). TENANT_ADMIN+ only. */
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

  if (stream.status !== "IDLE") {
    return jsonError(`Cannot start stream in ${stream.status} state`, 400);
  }

  const { allowed, reason } = await canStartStream(tenantId);
  if (!allowed) return jsonError(reason!, 403);

  const updated = await prisma.streamSession.update({
    where: { id },
    data: { status: "LIVE", startedAt: new Date() },
    include: { rink: { include: { green: { select: { name: true } } } } },
  });

  logAudit({
    session,
    action: "streaming.started",
    entity: "StreamSession",
    entityId: id,
    meta: { title: stream.title, rinkId: stream.rinkId },
  });

  // Notify all tenant members
  const tenantUsers = await prisma.user.findMany({
    where: { tenantId, suspended: false },
    select: { id: true },
  });
  const userIds = tenantUsers.map((u) => u.id).filter((uid) => uid !== session.user.id);

  for (const userId of userIds) {
    createNotification({
      tenantId,
      userId,
      type: "STREAM_LIVE" as never,
      title: "Stream Live",
      body: `${stream.title} is now live on ${updated.rink.name}`,
    }).catch(() => {});
  }

  sendToUsers(userIds, "stream-live", {
    streamId: id,
    title: stream.title,
    rinkName: updated.rink.name,
  });

  return NextResponse.json(updated);
}
