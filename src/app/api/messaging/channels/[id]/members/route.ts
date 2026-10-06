import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";
import { hasRole } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { getChannelById, isMember, addMember, removeMember, muteUser, unmuteUser } from "@/lib/messaging";
import { sendToUsers } from "@/lib/sse-connections";

type Ctx = { params: Promise<{ id: string }> };

/** List members of a channel. */
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

  return NextResponse.json(channel.members);
}

/** Add a member to a channel. Body: { userId, role? } */
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
  if (!channel || channel.tenantId !== tenantId) {
    return jsonError("Channel not found", 404);
  }

  const isAdmin = hasRole(getEffective(session).role, "TENANT_ADMIN");
  const membership = await isMember(id, session.user.id);
  if (!isAdmin && (!membership || membership.role === "MEMBER")) {
    return jsonError("Only channel admins/owners or tenant admins can add members", 403);
  }

  const { userId } = await req.json();
  if (!userId) return jsonError("userId is required");

  const existing = await isMember(id, userId);
  if (existing) return jsonError("User is already a member", 409);

  const member = await addMember(id, userId);

  const recipientIds = channel.members.map((m) => m.userId);
  sendToUsers(recipientIds, "channel_update", { channelId: id, type: "member_added", userId });

  return NextResponse.json(member, { status: 201 });
}

/** Remove a member or leave. Body: { userId? } — omit userId to leave. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
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

  const body = await req.json().catch(() => ({}));
  const targetUserId = (body as { userId?: string }).userId ?? session.user.id;
  const isSelf = targetUserId === session.user.id;

  if (!isSelf) {
    const isAdmin = hasRole(getEffective(session).role, "TENANT_ADMIN");
    const membership = await isMember(id, session.user.id);
    if (!isAdmin && (!membership || membership.role === "MEMBER")) {
      return jsonError("Only channel admins/owners or tenant admins can remove members", 403);
    }
  }

  const existing = await isMember(id, targetUserId);
  if (!existing) return jsonError("User is not a member", 404);

  await removeMember(id, targetUserId);

  const recipientIds = channel.members.map((m) => m.userId).filter((uid) => uid !== targetUserId);
  sendToUsers(recipientIds, "channel_update", { channelId: id, type: "member_removed", userId: targetUserId });

  if (!isSelf) {
    logAudit({ session, action: "messaging.member_removed", entity: "Channel", entityId: id, tenantId, meta: { removedUserId: targetUserId } });
  }

  return NextResponse.json({ ok: true });
}

/** Mute/unmute a member. PATCH body: { userId, mutedUntil? } — omit mutedUntil to unmute. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
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
  const membership = await isMember(id, session.user.id);
  if (!isAdmin && (!membership || membership.role === "MEMBER")) {
    return jsonError("Only channel admins/owners or tenant admins can mute members", 403);
  }

  const { userId, mutedUntil } = await req.json();
  if (!userId) return jsonError("userId is required");

  if (mutedUntil) {
    const until = new Date(mutedUntil);
    if (isNaN(until.getTime())) return jsonError("Invalid mutedUntil date");
    await muteUser(id, userId, until);

    logAudit({
      session,
      action: "messaging.member_muted",
      entity: "Channel",
      entityId: id,
      tenantId,
      meta: { mutedUserId: userId, until: until.toISOString() },
    });
  } else {
    await unmuteUser(id, userId);
  }

  return NextResponse.json({ ok: true });
}
