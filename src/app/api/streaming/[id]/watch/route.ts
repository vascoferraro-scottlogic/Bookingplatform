import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { validateStreamToken, getLiveViewerCount } from "@/lib/streaming";

type RouteContext = { params: Promise<{ id: string }> };

/** GET — get stream watch details. Checks auth or token for MEMBERS_ONLY streams. */
export async function GET(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  const stream = await prisma.streamSession.findUnique({
    where: { id },
    include: {
      rink: { include: { green: { select: { name: true } } } },
      event: { select: { id: true, title: true } },
      tenant: { select: { id: true, name: true, slug: true } },
    },
  });

  if (!stream) return jsonError("Stream not found", 404);

  // Public streams: no auth required
  if (stream.visibility === "PUBLIC") {
    const viewerCount = await getLiveViewerCount(id);
    return NextResponse.json({
      id: stream.id,
      title: stream.title,
      status: stream.status,
      visibility: stream.visibility,
      rink: stream.rink,
      event: stream.event,
      tenant: stream.tenant,
      streamKey: stream.status === "LIVE" ? stream.streamKey : null,
      viewerCount,
    });
  }

  // MEMBERS_ONLY: check token first, then session
  if (token) {
    const { valid } = await validateStreamToken(token);
    if (valid) {
      const viewerCount = await getLiveViewerCount(id);
      return NextResponse.json({
        id: stream.id,
        title: stream.title,
        status: stream.status,
        visibility: stream.visibility,
        rink: stream.rink,
        event: stream.event,
        tenant: stream.tenant,
        streamKey: stream.status === "LIVE" ? stream.streamKey : null,
        viewerCount,
        accessMethod: "TOKEN_LINK",
      });
    }
    return jsonError("Invalid or expired token", 403);
  }

  // Check authenticated user is a member of the tenant
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  if (session.user.tenantId !== stream.tenantId) {
    return jsonError("This stream is restricted to club members", 403);
  }

  const viewerCount = await getLiveViewerCount(id);
  return NextResponse.json({
    id: stream.id,
    title: stream.title,
    status: stream.status,
    visibility: stream.visibility,
    rink: stream.rink,
    event: stream.event,
    tenant: stream.tenant,
    streamKey: stream.status === "LIVE" ? stream.streamKey : null,
    viewerCount,
    accessMethod: "AUTHENTICATED",
  });
}
