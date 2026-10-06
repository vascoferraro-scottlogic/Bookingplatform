import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";
import { hasRole } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { pinMessage, softDeleteMessage, isMember, getChannelById } from "@/lib/messaging";
import { sendToUsers } from "@/lib/sse-connections";

type Ctx = { params: Promise<{ id: string; msgId: string }> };

/** Pin/unpin a message (admin or channel owner/admin). */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  if (!(await isFeatureEnabled(tenantId, "messaging"))) {
    return jsonError("Messaging is not enabled for this club", 403);
  }

  const { id, msgId } = await ctx.params;
  const channel = await getChannelById(id);
  if (!channel || channel.tenantId !== tenantId) {
    return jsonError("Channel not found", 404);
  }

  const isAdmin = hasRole(getEffective(session).role, "TENANT_ADMIN");
  const membership = await isMember(id, session.user.id);
  if (!isAdmin && (!membership || membership.role === "MEMBER")) {
    return jsonError("Only channel admins/owners or tenant admins can pin messages", 403);
  }

  const message = await prisma.message.findUnique({ where: { id: msgId } });
  if (!message || message.channelId !== id) {
    return jsonError("Message not found", 404);
  }

  const { pinned } = await req.json();
  const updated = await pinMessage(msgId, !!pinned);

  const recipientIds = channel.members.map((m) => m.userId);
  sendToUsers(recipientIds, "channel_update", { channelId: id, type: "pin", messageId: msgId, pinned: updated.pinned });

  return NextResponse.json(updated);
}

/** Soft-delete a message (author or admin). */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  if (!(await isFeatureEnabled(tenantId, "messaging"))) {
    return jsonError("Messaging is not enabled for this club", 403);
  }

  const { id, msgId } = await ctx.params;
  const channel = await getChannelById(id);
  if (!channel || channel.tenantId !== tenantId) {
    return jsonError("Channel not found", 404);
  }

  const message = await prisma.message.findUnique({ where: { id: msgId } });
  if (!message || message.channelId !== id) {
    return jsonError("Message not found", 404);
  }

  const isAdmin = hasRole(getEffective(session).role, "TENANT_ADMIN");
  if (!isAdmin && message.userId !== session.user.id) {
    return jsonError("You can only delete your own messages", 403);
  }

  await softDeleteMessage(msgId);

  logAudit({
    session,
    action: "messaging.message_deleted",
    entity: "Message",
    entityId: msgId,
    tenantId,
    meta: { channelId: id, moderator: isAdmin && message.userId !== session.user.id },
  });

  const recipientIds = channel.members.map((m) => m.userId);
  sendToUsers(recipientIds, "channel_update", { channelId: id, type: "message_deleted", messageId: msgId });

  return NextResponse.json({ ok: true });
}
