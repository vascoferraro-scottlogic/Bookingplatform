import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";

/**
 * POST /api/federations/invite/[token]/decline — decline a federation invitation.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;
  const { tenantId, error: tErr } = resolveTenantId(session);
  if (tErr) return tErr;

  const invite = await prisma.federationInvite.findUnique({ where: { token } });
  if (!invite) return jsonError("Invitation not found", 404);
  if (invite.status !== "PENDING") return jsonError(`Invitation is ${invite.status.toLowerCase()}`, 400);
  if (invite.inviteeTenantId !== tenantId) return jsonError("This invitation is for a different club", 403);

  await prisma.federationInvite.update({
    where: { id: invite.id },
    data: { status: "DECLINED" },
  });

  return NextResponse.json({ ok: true });
}
