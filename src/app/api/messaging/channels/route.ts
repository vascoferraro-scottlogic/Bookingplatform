import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";
import { logAudit } from "@/lib/audit";
import { createChannel, getUserChannels, getOrCreateDirectChannel } from "@/lib/messaging";
import type { ChannelType } from "@prisma/client";

const VALID_TYPES: ChannelType[] = ["PUBLIC", "PRIVATE", "GROUP", "DIRECT"];

/** List channels the current user belongs to, with unread counts. */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  if (!(await isFeatureEnabled(tenantId, "messaging"))) {
    return jsonError("Messaging is not enabled for this club", 403);
  }

  const channels = await getUserChannels(session.user.id, tenantId);
  return NextResponse.json(channels);
}

/** Create a channel or start a DM. */
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  if (!(await isFeatureEnabled(tenantId, "messaging"))) {
    return jsonError("Messaging is not enabled for this club", 403);
  }

  const body = await req.json();
  const { name, type, description, memberIds, targetUserId } = body as {
    name?: string;
    type?: ChannelType;
    description?: string;
    memberIds?: string[];
    targetUserId?: string;
  };

  // DM shortcut
  if (targetUserId) {
    const channel = await getOrCreateDirectChannel(tenantId, session.user.id, targetUserId);
    return NextResponse.json(channel, { status: 201 });
  }

  if (!name || !type) {
    return jsonError("name and type are required");
  }
  if (!VALID_TYPES.includes(type)) {
    return jsonError(`type must be one of: ${VALID_TYPES.join(", ")}`);
  }
  if (type === "DIRECT") {
    return jsonError("Use targetUserId to create a direct message channel");
  }

  const channel = await createChannel({ tenantId, createdById: session.user.id, name, type, description, memberIds });

  logAudit({
    session,
    action: "messaging.channel_created",
    entity: "Channel",
    entityId: channel.id,
    tenantId,
    meta: { name, type },
  });

  return NextResponse.json(channel, { status: 201 });
}
