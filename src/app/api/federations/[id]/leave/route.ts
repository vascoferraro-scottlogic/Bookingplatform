import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";

/**
 * POST /api/federations/[id]/leave — leave a federation.
 * Sets leftAt on the FederationMembership. Does not delete it.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;
  const { tenantId, error: tErr } = resolveTenantId(session);
  if (tErr) return tErr;

  const membership = await prisma.federationMembership.findFirst({
    where: { federationId: id, tenantId, leftAt: null },
  });
  if (!membership) return jsonError("You are not a member of this federation", 404);

  await prisma.federationMembership.update({
    where: { id: membership.id },
    data: { leftAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
