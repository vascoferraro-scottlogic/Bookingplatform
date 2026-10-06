import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { hasRole, getEffectiveRole, type ActingAsClaim, type EffectiveRole } from "@/lib/roles";

export type AppSession = {
  user: {
    id: string;
    email: string;
    name?: string | null;
    role: Role;
    tenantId: string | null;
    actingAs?: ActingAsClaim | null;
  };
};

/** Get authenticated session or return 401. */
export async function getSessionOrFail(): Promise<
  | { session: AppSession; error?: undefined }
  | { session?: undefined; error: NextResponse }
> {
  const session = (await getServerSession(authOptions)) as AppSession | null;
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { session };
}

/**
 * Assert minimum role using the user's **real** role (ignores impersonation).
 *
 * Use this for platform-plane gates (e.g. `/api/admin/tenants`) that should
 * remain available to platform admins regardless of impersonation, or for
 * pure tenant-plane gates that should NOT be satisfied by impersonation.
 *
 * Most tenant-scoped gates should instead use {@link assertEffectiveRoleOrFail}.
 */
export function assertRoleOrFail(session: AppSession, minimum: Role): NextResponse | null {
  if (!hasRole(session.user.role, minimum)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/**
 * Assert minimum role using the **effective** role (impersonation-aware).
 *
 * A non-impersonating PLATFORM_ADMIN does NOT satisfy a TENANT_ADMIN gate;
 * it must first start an impersonation. The dedicated 403 body lets the UI
 * redirect such requests to the tenant picker.
 */
export function assertEffectiveRoleOrFail(
  session: AppSession,
  minimum: Role,
): NextResponse | null {
  const eff = getEffectiveRole(session.user);
  if (hasRole(eff.role, minimum)) return null;
  if (session.user.role === "PLATFORM_ADMIN" && !eff.isImpersonating) {
    return NextResponse.json(
      { error: "PLATFORM_ADMIN_NO_CONTEXT", message: "Platform admin must start an impersonation to act on a tenant." },
      { status: 403 },
    );
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/**
 * Reject the request when the session is currently impersonating.
 * Use on platform-only endpoints (`/api/admin/tenants`, `/api/admin/payments`)
 * to force the platform admin to exit impersonation before performing
 * platform-plane operations.
 */
export function rejectIfImpersonating(session: AppSession): NextResponse | null {
  if (session.user.actingAs) {
    return NextResponse.json(
      { error: "EXIT_IMPERSONATION_REQUIRED", message: "Exit impersonation before using platform endpoints." },
      { status: 409 },
    );
  }
  return null;
}

/** Convenience: get the effective-role view for a session. */
export function getEffective(session: AppSession): EffectiveRole {
  return getEffectiveRole(session.user);
}

/** Standard JSON error response. */
export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
