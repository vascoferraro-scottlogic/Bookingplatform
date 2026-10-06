import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import type { Permission } from "@prisma/client";

/**
 * PUT /api/groups/[id]/grants — replace all grants for a group.
 * Body: { permissions: Permission[] }
 *
 * Full replacement (not patch) — the client sends the complete set.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const permissions: Permission[] = Array.isArray(body.permissions) ? body.permissions : [];

  // Transaction: delete all existing grants, create new ones
  await prisma.$transaction([
    prisma.permissionGrant.deleteMany({ where: { groupId: id } }),
    ...permissions.map((p: Permission) =>
      prisma.permissionGrant.create({ data: { groupId: id, permission: p } }),
    ),
  ]);

  const updated = await prisma.permissionGroup.findUnique({
    where: { id },
    include: { grants: { select: { id: true, permission: true } } },
  });

  return NextResponse.json(updated);
}
