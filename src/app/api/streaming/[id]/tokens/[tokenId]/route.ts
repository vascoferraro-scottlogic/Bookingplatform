import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { hasRole } from "@/lib/roles";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

type RouteContext = { params: Promise<{ id: string; tokenId: string }> };

/** DELETE — revoke a stream token. TENANT_ADMIN+ only. */
export async function DELETE(req: NextRequest, context: RouteContext) {
  const { id, tokenId } = await context.params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  if (!hasRole(session.user.role, "TENANT_ADMIN")) {
    return jsonError("Forbidden", 403);
  }

  const token = await prisma.streamToken.findFirst({
    where: { id: tokenId, streamSessionId: id, tenantId },
  });
  if (!token) return jsonError("Token not found", 404);

  await prisma.streamToken.delete({ where: { id: tokenId } });

  logAudit({
    session,
    action: "streaming.token_revoked",
    entity: "StreamToken",
    entityId: tokenId,
    meta: { streamSessionId: id },
  });

  return NextResponse.json({ success: true });
}
