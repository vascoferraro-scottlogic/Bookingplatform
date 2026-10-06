import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import type { Permission } from "@prisma/client";

/**
 * GET /api/groups — list permission groups for the current tenant.
 * TENANT_ADMIN only.
 */
export async function GET() {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;
  const { tenantId, error: tErr } = resolveTenantId(session);
  if (tErr) return tErr;

  const groups = await prisma.permissionGroup.findMany({
    where: { tenantId },
    include: {
      _count: { select: { grants: true, members: true } },
    },
    orderBy: [{ isBuiltIn: "desc" }, { name: "asc" }],
  });

  return NextResponse.json(groups);
}

/**
 * POST /api/groups — create a custom permission group.
 * Body: { name: string, description?: string, permissions?: Permission[] }
 */
export async function POST(req: Request) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;
  const { tenantId, error: tErr } = resolveTenantId(session);
  if (tErr) return tErr;

  const body = await req.json();
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  // Check for duplicate name
  const existing = await prisma.permissionGroup.findUnique({
    where: { tenantId_name: { tenantId, name } },
  });
  if (existing) {
    return NextResponse.json({ error: "A group with that name already exists" }, { status: 409 });
  }

  const permissions: Permission[] = Array.isArray(body.permissions) ? body.permissions : [];

  const group = await prisma.permissionGroup.create({
    data: {
      tenantId,
      name,
      description: body.description ?? null,
      grants: permissions.length > 0
        ? { create: permissions.map((p: Permission) => ({ permission: p })) }
        : undefined,
    },
    include: { _count: { select: { grants: true, members: true } } },
  });

  return NextResponse.json(group, { status: 201 });
}
