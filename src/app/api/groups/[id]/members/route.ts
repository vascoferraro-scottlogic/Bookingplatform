import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";

/**
 * POST /api/groups/[id]/members — add a member to a group.
 * Body: { membershipId: string }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;
  const { tenantId, error: tErr } = resolveTenantId(session);
  if (tErr) return tErr;

  const group = await prisma.permissionGroup.findFirst({ where: { id, tenantId } });
  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  const body = await req.json();
  const membershipId = body.membershipId;
  if (!membershipId) {
    return NextResponse.json({ error: "membershipId is required" }, { status: 400 });
  }

  // Verify membership belongs to this tenant
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, tenantId },
  });
  if (!membership) {
    return NextResponse.json({ error: "Membership not found in this tenant" }, { status: 404 });
  }

  // Check for duplicate
  const existing = await prisma.groupMember.findUnique({
    where: { groupId_membershipId: { groupId: id, membershipId } },
  });
  if (existing) {
    return NextResponse.json({ error: "Already a member of this group" }, { status: 409 });
  }

  const member = await prisma.groupMember.create({
    data: { groupId: id, membershipId },
    include: {
      membership: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });

  return NextResponse.json(member, { status: 201 });
}
