import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/api-utils";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { validateStreamToken, incrementTokenUse } from "@/lib/streaming";
import { logTrackingEvent, parseUserAgent, detectDeviceType } from "@/lib/tracking";
import type { AppSession } from "@/lib/api-utils";

type RouteContext = { params: Promise<{ id: string }> };

/** POST — register a viewer joining a stream. */
export async function POST(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await req.json();
  const { sessionFingerprint, token } = body;

  if (!sessionFingerprint) {
    return jsonError("sessionFingerprint is required");
  }

  const stream = await prisma.streamSession.findUnique({ where: { id } });
  if (!stream) return jsonError("Stream not found", 404);
  if (stream.status !== "LIVE") return jsonError("Stream is not live", 400);

  let userId: string | null = null;
  let accessMethod: "AUTHENTICATED" | "TOKEN_LINK" = "AUTHENTICATED";
  let tokenId: string | null = null;

  // Try session auth
  const session = (await getServerSession(authOptions)) as AppSession | null;
  if (session) {
    userId = session.user.id;
  }

  // Token-based access
  if (token) {
    const result = await validateStreamToken(token);
    if (!result.valid) return jsonError("Invalid or expired token", 403);
    accessMethod = "TOKEN_LINK";
    tokenId = result.tokenId!;
    await incrementTokenUse(tokenId);
  } else if (stream.visibility === "MEMBERS_ONLY" && !session) {
    return jsonError("Authentication required for members-only stream", 401);
  } else if (stream.visibility === "MEMBERS_ONLY" && session?.user.tenantId !== stream.tenantId) {
    return jsonError("This stream is restricted to club members", 403);
  }

  const viewer = await prisma.streamViewer.create({
    data: {
      streamSessionId: id,
      userId,
      sessionFingerprint,
      accessMethod,
      tokenId,
    },
  });

  const ua = req.headers.get("user-agent") || "";
  const { browserFamily, browserVersion, osFamily } = parseUserAgent(ua);
  const deviceType = detectDeviceType(ua);

  logTrackingEvent({
    tenantId: stream.tenantId,
    userId,
    sessionFingerprint,
    eventType: "FEATURE_USE",
    path: `/streaming/${id}`,
    action: "streaming.viewer_joined",
    entity: "StreamSession",
    entityId: id,
    browserFamily,
    browserVersion,
    osFamily,
    deviceType,
  });

  return NextResponse.json({ viewerId: viewer.id }, { status: 201 });
}
