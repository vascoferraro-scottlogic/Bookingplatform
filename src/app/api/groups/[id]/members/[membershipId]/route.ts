import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";

/**
 * DELETE /api/groups/[id]/members/[membershipId] — remove a member from a group.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; membershipId: string }> },
) {
  const { id, membershipId } = await params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;
  const { tenantId, error: tErr } = resolveTenantId(session);
  if (tErr) return tErr;

  // Verify group belongs to this tenant
  const group = await prisma.permissionGroup.findFirst({ where: { id, tenantId } });
  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  const gm = await prisma.groupMember.findUnique({
    where: { groupId_membershipId: { groupId: id, membershipId } },
  });
  if (!gm) {
    return NextResponse.json({ error: "Member not in this group" }, { status: 404 });
  }

  await prisma.groupMember.delete({ where: { id: gm.id } });
  return NextResponse.json({ ok: true });
}
