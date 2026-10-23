import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";
import { logAudit } from "@/lib/audit";
import { archiveEndedStreams } from "@/lib/streaming";

/** GET — list stream sessions for a tenant. */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const flagOn = await isFeatureEnabled(tenantId, "liveStreaming");
  if (!flagOn) return jsonError("Live streaming is not enabled for this tenant", 403);

  // Enforce archive retention (FR-STR-002)
  await archiveEndedStreams(tenantId).catch(() => {});

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const rinkId = searchParams.get("rinkId");

  const streams = await prisma.streamSession.findMany({
    where: {
      tenantId,
      ...(status ? { status: status as never } : {}),
      ...(rinkId ? { rinkId } : {}),
    },
    include: {
      rink: { include: { green: { select: { name: true } } } },
      event: { select: { id: true, title: true } },
      createdBy: { select: { id: true, name: true } },
      _count: { select: { viewers: { where: { leftAt: null } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(streams);
}

/** POST — create a new stream session. MAINTENANCE+ (FR-STR-001). */
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const roleErr = assertEffectiveRoleOrFail(session, "MAINTENANCE");
  if (roleErr) return roleErr;

  const flagOn = await isFeatureEnabled(tenantId, "liveStreaming");
  if (!flagOn) return jsonError("Live streaming is not enabled for this tenant", 403);

  const body = await req.json();
  const { title, rinkId, eventId, visibility } = body;

  if (!title || !rinkId) {
    return jsonError("title and rinkId are required");
  }

  // Validate rink belongs to tenant
  const rink = await prisma.rink.findFirst({
    where: { id: rinkId, green: { tenantId } },
  });
  if (!rink) return jsonError("Rink not found or does not belong to this tenant", 404);

  // Validate event if provided
  if (eventId) {
    const event = await prisma.event.findFirst({
      where: { id: eventId, tenantId },
    });
    if (!event) return jsonError("Event not found or does not belong to this tenant", 404);
  }

  const stream = await prisma.streamSession.create({
    data: {
      tenantId,
      rinkId,
      eventId: eventId || null,
      title,
      visibility: visibility === "PUBLIC" ? "PUBLIC" : "MEMBERS_ONLY",
      createdById: session.user.id,
    },
    include: {
      rink: { include: { green: { select: { name: true } } } },
    },
  });

  logAudit({
    session,
    action: "streaming.created",
    entity: "StreamSession",
    entityId: stream.id,
    meta: { title, rinkId, visibility: stream.visibility },
  });

  return NextResponse.json(stream, { status: 201 });
}
