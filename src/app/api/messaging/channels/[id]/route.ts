import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";
import { hasRole } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { getChannelById, isMember } from "@/lib/messaging";

type Ctx = { params: Promise<{ id: string }> };

/** Get channel detail + members. */
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

  return NextResponse.json(channel);
}

/** Update channel name/description (admin or channel owner). */
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
  if (!isAdmin && membership?.role !== "OWNER") {
    return jsonError("Only channel owner or admin can update channels", 403);
  }

  const { name, description } = await req.json();
  const updated = await prisma.channel.update({
    where: { id },
    data: { ...(name !== undefined ? { name } : {}), ...(description !== undefined ? { description } : {}) },
    include: { members: { include: { user: { select: { id: true, name: true, email: true } } } } },
  });

  logAudit({ session, action: "messaging.channel_updated", entity: "Channel", entityId: id, tenantId });

  return NextResponse.json(updated);
}

/** Delete (hard-delete) a channel (admin only). */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  if (!(await isFeatureEnabled(tenantId, "messaging"))) {
    return jsonError("Messaging is not enabled for this club", 403);
  }

  const roleErr = hasRole(getEffective(session).role, "TENANT_ADMIN");
  if (!roleErr) {
    return jsonError("Only admins can delete channels", 403);
  }

  const { id } = await ctx.params;
  const channel = await getChannelById(id);
  if (!channel || channel.tenantId !== tenantId) {
    return jsonError("Channel not found", 404);
  }

  await prisma.channel.delete({ where: { id } });

  logAudit({ session, action: "messaging.channel_deleted", entity: "Channel", entityId: id, tenantId, meta: { name: channel.name } });

  return NextResponse.json({ ok: true });
}
