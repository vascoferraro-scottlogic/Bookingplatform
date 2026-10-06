import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-utils";
import { getEffectiveRole, type ActingAsClaim } from "@/lib/roles";
import type { Role } from "@prisma/client";

/**
 * Resolve the tenantId the caller is acting on.
 *
 * - Tenant users: their own `tenantId`.
 * - PLATFORM_ADMIN currently impersonating: the impersonated tenantId
 *   (from `actingAs.tenantId`). Carried through transparently.
 * - PLATFORM_ADMIN NOT impersonating: returns a 403
 *   `PLATFORM_ADMIN_NO_CONTEXT` so the client can redirect to the
 *   tenant picker. The previous `?tenantId=` cross-tenant override
 *   has been removed — platform admins must explicitly start an
 *   impersonation to act on a tenant.
 *
 * `req` is accepted for backwards compatibility but is no longer used
 * to derive the tenant.
 */
export function resolveTenantId(
  session: {
    user: {
      id: string;
      tenantId?: string | null;
      role: Role;
      actingAs?: ActingAsClaim | null;
    };
  },
  _req?: NextRequest,
): { tenantId: string; error: null } | { tenantId: null; error: NextResponse } {
  const eff = getEffectiveRole(session.user);

  if (eff.tenantId) {
    return { tenantId: eff.tenantId, error: null };
  }

  if (session.user.role === "PLATFORM_ADMIN" && !eff.isImpersonating) {
    return {
      tenantId: null,
      error: NextResponse.json(
        {
          error: "PLATFORM_ADMIN_NO_CONTEXT",
          message: "Platform admin must start an impersonation to act on a tenant.",
        },
        { status: 403 },
      ),
    };
  }

  return { tenantId: null, error: jsonError("No tenant context", 400) };
}
