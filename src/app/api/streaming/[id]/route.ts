import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { hasRole } from "@/lib/roles";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";
import { logAudit } from "@/lib/audit";
import { getLiveViewerCount } from "@/lib/streaming";

type RouteContext = { params: Promise<{ id: string }> };

/** GET — single stream session details. */
export async function GET(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const stream = await prisma.streamSession.findFirst({
    where: { id, tenantId },
    include: {
      rink: { include: { green: { select: { name: true } } } },
      event: { select: { id: true, title: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });

  if (!stream) return jsonError("Stream not found", 404);

  const viewerCount = await getLiveViewerCount(id);

  return NextResponse.json({ ...stream, viewerCount });
}

/** PATCH — update stream title/visibility. TENANT_ADMIN+ only. */
export async function PATCH(req: NextRequest, context: RouteContext) {
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

  const body = await req.json();
  const { title, visibility } = body;

  const updated = await prisma.streamSession.update({
    where: { id },
    data: {
      ...(title ? { title } : {}),
      ...(visibility ? { visibility } : {}),
    },
  });

  logAudit({
    session,
    action: "streaming.updated",
    entity: "StreamSession",
    entityId: id,
    meta: { title, visibility },
  });

  return NextResponse.json(updated);
}

/** DELETE — delete IDLE/ENDED streams only. TENANT_ADMIN+ only. */
export async function DELETE(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  if (!hasRole(session.user.role, "TENANT_ADMIN")) {
    return jsonError("Forbidden", 403);
  }

  const flagOn = await isFeatureEnabled(tenantId, "liveStreaming");
  if (!flagOn) return jsonError("Live streaming is not enabled", 403);

  const stream = await prisma.streamSession.findFirst({ where: { id, tenantId } });
  if (!stream) return jsonError("Stream not found", 404);

  if (stream.status === "LIVE") {
    return jsonError("Cannot delete a live stream. Stop it first.", 400);
  }

  await prisma.streamViewer.deleteMany({ where: { streamSessionId: id } });
  await prisma.streamToken.deleteMany({ where: { streamSessionId: id } });
  await prisma.streamSession.delete({ where: { id } });

  logAudit({
    session,
    action: "streaming.deleted",
    entity: "StreamSession",
    entityId: id,
  });

  return NextResponse.json({ success: true });
}
