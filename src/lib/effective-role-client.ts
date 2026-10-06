import type { Session } from "next-auth";

export type ClientActingAs = {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: string;
  impersonationId: string;
  startedAt: string;
} | null | undefined;

export type ClientEffectiveRole = {
  role: string;                   // effective role
  realRole: string;               // real role (always)
  isImpersonating: boolean;
  isPlatformAdmin: boolean;       // real role === PLATFORM_ADMIN
  isRealTenantAdmin: boolean;     // real role === TENANT_ADMIN
  isTenantAdminEffective: boolean; // effective role >= TENANT_ADMIN
  acting: ClientActingAs;
  tenantId: string | null;        // effective tenantId
};

/**
 * Pure client-side projection of a NextAuth session into an effective-role view.
 * Mirrors `getEffectiveRole` on the server. Use to drive UI gating without
 * sprinkling `role === "PLATFORM_ADMIN"` checks everywhere.
 */
export function getClientEffectiveRole(session: Session | null | undefined): ClientEffectiveRole {
  const user = (session?.user ?? null) as
    | { role?: string; tenantId?: string | null; actingAs?: ClientActingAs }
    | null;
  const realRole = user?.role ?? "GUEST";
  const acting = user?.actingAs ?? null;
  const isImpersonating = !!acting;
  const role = isImpersonating ? acting!.role : realRole;
  const tenantId = isImpersonating ? acting!.tenantId : user?.tenantId ?? null;

  return {
    role,
    realRole,
    isImpersonating,
    isPlatformAdmin: realRole === "PLATFORM_ADMIN",
    isRealTenantAdmin: realRole === "TENANT_ADMIN",
    isTenantAdminEffective: role === "TENANT_ADMIN",
    acting,
    tenantId,
  };
}
