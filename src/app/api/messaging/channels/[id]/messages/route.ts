import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";
import { hasRole } from "@/lib/roles";
import { getChannelById, getChannelMessages, sendMessage, isMember } from "@/lib/messaging";
import { sendToUsers } from "@/lib/sse-connections";

type Ctx = { params: Promise<{ id: string }> };

/** Get paginated messages for a channel. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  if (!(await isFeatureEnabled(tenantId, "messaging"))) {
    return jsonError("Messaging is not enabled for this club", 403);
  }

  const { id } = await ctx.params;
  const channel = await getChannelById(id);
  if (!channel || channel.tenantId !== tenantId) {
    return jsonError("Channel not found", 404);
  }

  const isAdmin = hasRole(getEffective(session).role, "TENANT_ADMIN");
  if (!isAdmin && !(await isMember(id, session.user.id))) {
    return jsonError("Not a member of this channel", 403);
  }

  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "50"), 100);
  const messages = await getChannelMessages(id, cursor, limit);

  return NextResponse.json(messages);
}

/** Send a message to a channel. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  if (!(await isFeatureEnabled(tenantId, "messaging"))) {
    return jsonError("Messaging is not enabled for this club", 403);
  }

  const { id } = await ctx.params;
  const channel = await getChannelById(id);
  if (!channel) {
    return jsonError("Channel not found", 404);
  }

  const membership = await isMember(id, session.user.id);
  if (!membership && !hasRole(session.user.role, "TENANT_ADMIN")) {
    return jsonError("Not a member of this channel", 403);
  }

  if (membership?.mutedUntil && membership.mutedUntil > new Date()) {
    return jsonError(`You are muted until ${membership.mutedUntil.toISOString()}`, 403);
  }

  const { body } = await req.json();
  if (!body || typeof body !== "string" || body.trim().length === 0) {
    return jsonError("Message body is required");
  }
  if (body.length > 2000) {
    return jsonError("Message body must be 2000 characters or less");
  }

  const message = await sendMessage({ channelId: id, tenantId, userId: session.user.id, body: body.trim() });

  // Fan out via SSE to all channel members
  const recipientIds = channel.members.map((m) => m.userId).filter((uid) => uid !== session.user.id);
  sendToUsers(recipientIds, "message", { channelId: id, message });

  return NextResponse.json(message, { status: 201 });
}
