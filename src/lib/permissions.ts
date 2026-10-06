import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEffectiveRole } from "./roles";
import type { AppSession } from "./api-utils";
import type { Permission as PrismaPermission } from "@prisma/client";

// Re-export client-safe constants so server callers can import from one place.
export { Permission, PERMISSION_DOMAINS, ALL_PERMISSIONS } from "@/lib/permission-defs";
import { ALL_PERMISSIONS } from "@/lib/permission-defs";

/**
 * Assert that the current session has `permission` within `tenantId` scope.
 * - `tenantId` may be supplied (from `resolveTenantId`) or null to use the
 *   session's effective tenant context (impersonation-aware).
 * - `TENANT_ADMIN` (or impersonating-as-TENANT_ADMIN) bypasses checks.
 * - Non-impersonating `PLATFORM_ADMIN` is rejected with a special 403 body.
 */
export async function assertPermissionOrFail(
  session: AppSession,
  a: string | null | PrismaPermission,
  b?: PrismaPermission,
): Promise<ReturnType<typeof NextResponse.json> | null> {
  // Support both signatures:
  //  - assertPermissionOrFail(session, permission)
  //  - assertPermissionOrFail(session, tenantId, permission)
  const eff = getEffectiveRole(session.user);

  const permission = (b === undefined ? (a as PrismaPermission) : (b as PrismaPermission));
  const tenantIdOverride = b === undefined ? null : (a as string | null);

  // Tenant admin (real or impersonated) = implicit all-permissions
  if (eff.role === "TENANT_ADMIN") return null;

  // PLATFORM_ADMIN not impersonating has no tenant context
  if (session.user.role === "PLATFORM_ADMIN" && !eff.isImpersonating) {
    return NextResponse.json(
      { error: "PLATFORM_ADMIN_NO_CONTEXT", message: "Platform admin must start an impersonation to act on a tenant." },
      { status: 403 },
    );
  }

  const tenantToCheck = tenantIdOverride ?? eff.tenantId;
  if (!tenantToCheck) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const match = await prisma.groupMember.findFirst({
    where: {
      membership: { userId: eff.realUserId, tenantId: tenantToCheck },
      group: {
        tenantId: tenantToCheck,
        grants: { some: { permission } },
      },
    },
  });

  if (match) return null;
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/** Non-throwing check returning true/false. */
export async function hasPermission(
  session: AppSession,
  a: string | null | PrismaPermission,
  b?: PrismaPermission,
): Promise<boolean> {
  if (b === undefined) {
    return (await assertPermissionOrFail(session, a as PrismaPermission)) === null;
  }
  return (await assertPermissionOrFail(session, a as string | null, b as PrismaPermission)) === null;
}

/** Return the full set of effective permissions for the current user in their active tenant. */
export async function getEffectivePermissions(session: AppSession): Promise<PrismaPermission[]> {
  const eff = getEffectiveRole(session.user);
  if (eff.role === "TENANT_ADMIN") return ALL_PERMISSIONS;

  const tenantId = eff.tenantId;
  if (!tenantId) return [];

  const grants = await prisma.permissionGrant.findMany({
    where: {
      group: {
        tenantId,
        members: { some: { membership: { userId: eff.realUserId, tenantId } } },
      },
    },
    select: { permission: true },
    distinct: ["permission"],
  });

  return grants.map((g) => g.permission);
}
