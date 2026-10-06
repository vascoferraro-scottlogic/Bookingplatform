import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";
import { isMember, updateReadCursor } from "@/lib/messaging";

type Ctx = { params: Promise<{ id: string }> };

/** Update read cursor for a channel. Body: { lastReadMessageId } */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  if (!(await isFeatureEnabled(tenantId, "messaging"))) {
    return jsonError("Messaging is not enabled for this club", 403);
  }

  const { id } = await ctx.params;
  const membership = await isMember(id, session.user.id);
  if (!membership) {
    return jsonError("Not a member of this channel", 403);
  }

  const { lastReadMessageId } = await req.json();
  if (!lastReadMessageId) return jsonError("lastReadMessageId is required");

  await updateReadCursor(id, session.user.id, lastReadMessageId);

  return NextResponse.json({ ok: true });
}
