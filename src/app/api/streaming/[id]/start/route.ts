import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { startStreamAtomically } from "@/lib/streaming";
import { createNotification } from "@/lib/notifications";
import { sendToUsers } from "@/lib/sse-connections";

type RouteContext = { params: Promise<{ id: string }> };

/** POST — start a stream (IDLE → LIVE). MAINTENANCE+ (FR-STR-001). */
export async function POST(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const roleErr = assertEffectiveRoleOrFail(session, "MAINTENANCE");
  if (roleErr) return roleErr;

  const stream = await prisma.streamSession.findFirst({ where: { id, tenantId } });
  if (!stream) return jsonError("Stream not found", 404);

  if (stream.status !== "IDLE") {
    return jsonError(`Cannot start stream in ${stream.status} state`, 400);
  }

  const { started, reason } = await startStreamAtomically(tenantId, id);
  if (!started) return jsonError(reason!, 403);

  const updated = await prisma.streamSession.findFirst({
    where: { id, tenantId },
    include: { rink: { include: { green: { select: { name: true } } } } },
  });
  if (!updated) return jsonError("Stream not found", 404);

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
      type: "STREAM_LIVE",
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
