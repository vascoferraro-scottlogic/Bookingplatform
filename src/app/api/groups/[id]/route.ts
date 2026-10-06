import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";

/**
 * GET /api/groups/[id] — get a single group with grants + members.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;
  const { tenantId, error: tErr } = resolveTenantId(session);
  if (tErr) return tErr;

  const group = await prisma.permissionGroup.findFirst({
    where: { id, tenantId },
    include: {
      grants: { select: { id: true, permission: true } },
      members: {
        include: {
          membership: {
            include: { user: { select: { id: true, name: true, email: true } } },
          },
        },
      },
    },
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  return NextResponse.json(group);
}

/**
 * PATCH /api/groups/[id] — update group name/description.
 * Body: { name?: string, description?: string }
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  if (group.isBuiltIn) {
    return NextResponse.json({ error: "Cannot rename built-in groups" }, { status: 400 });
  }

  const body = await req.json();
  const data: Record<string, string> = {};
  if (body.name !== undefined) {
    const name = (body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    // Check for duplicate name
    const dup = await prisma.permissionGroup.findFirst({
      where: { tenantId, name, id: { not: id } },
    });
    if (dup) return NextResponse.json({ error: "A group with that name already exists" }, { status: 409 });
    data.name = name;
  }
  if (body.description !== undefined) {
    data.description = body.description ?? "";
  }

  const updated = await prisma.permissionGroup.update({
    where: { id },
    data,
  });

  return NextResponse.json(updated);
}

/**
 * DELETE /api/groups/[id] — delete a custom group.
 * Built-in groups cannot be deleted.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  if (group.isBuiltIn) {
    return NextResponse.json({ error: "Cannot delete built-in groups" }, { status: 400 });
  }

  await prisma.permissionGroup.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
