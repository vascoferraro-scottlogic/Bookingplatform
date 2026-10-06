import { NextResponse } from "next/server";
import { getSessionOrFail, getEffective } from "@/lib/api-utils";
import { getEffectivePermissions, PERMISSION_DOMAINS } from "@/lib/permissions";

/**
 * GET /api/permissions/me
 *
 * Returns the current user's effective permissions for their active tenant.
 * TENANT_ADMIN receives all permissions. Others receive the union of grants
 * from all permission groups they belong to.
 *
 * Used by the client to conditionally show/hide UI elements based on
 * fine-grained permissions rather than role checks.
 */
export async function GET() {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const permissions = await getEffectivePermissions(session);
  const eff = getEffective(session);
  return NextResponse.json({
    permissions,
    domains: Object.keys(PERMISSION_DOMAINS),
    effectiveUserId: eff.realUserId,
    effectiveRole: eff.role,
    isImpersonating: eff.isImpersonating,
  });
}
