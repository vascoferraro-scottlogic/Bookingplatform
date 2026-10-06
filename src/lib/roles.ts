import type { Role } from "@prisma/client";

/**
 * Role hierarchy is **orthogonal**, not a single ladder.
 *
 * `PLATFORM_ADMIN` is a separate plane: it has zero implicit tenant powers.
 * To act on tenant resources a platform admin must impersonate a tenant
 * (see {@link getEffectiveRole} and the Impersonation model).
 *
 * Within the tenant plane, roles do form a small ladder:
 *   GUEST  <  USER  <  MAINTENANCE  <  TENANT_ADMIN
 *
 * `hasRole(actor, minimum)` answers: "does `actor` natively satisfy
 * the gate `minimum`?" — without considering impersonation. Callers
 * that want impersonation taken into account should consult the
 * effective role from the session (see {@link getEffectiveRole}).
 */

const TENANT_RANK: Partial<Record<Role, number>> = {
  GUEST: 0,
  USER: 1,
  MAINTENANCE: 2,
  TENANT_ADMIN: 3,
};

/** True when `r` is a tenant-plane role (i.e. not PLATFORM_ADMIN). */
export function isTenantRole(r: Role): boolean {
  return r in TENANT_RANK;
}

/** True for the platform plane role. */
export function isPlatformAdmin(r: Role): boolean {
  return r === "PLATFORM_ADMIN";
}

/**
 * True when `actor` natively meets the gate `minimum`.
 *
 * - Tenant-plane comparisons use the small ladder.
 * - PLATFORM_ADMIN matches **only** PLATFORM_ADMIN. It does NOT inherit
 *   tenant powers — that is the whole point of the orthogonal model.
 */
export function hasRole(actor: Role, minimum: Role): boolean {
  if (minimum === "PLATFORM_ADMIN") return actor === "PLATFORM_ADMIN";
  if (actor === "PLATFORM_ADMIN") return false;
  const a = TENANT_RANK[actor];
  const m = TENANT_RANK[minimum];
  if (a === undefined || m === undefined) return false;
  return a >= m;
}

/** Throws if the user doesn't meet the minimum role. */
export function requireRole(userRole: Role, minimum: Role): void {
  if (!hasRole(userRole, minimum)) {
    throw new Error(`Requires at least ${minimum} role`);
  }
}

// ─── Effective role (impersonation-aware) ────────────────────

/**
 * Shape of the optional impersonation claim on the session.
 * Set when a PLATFORM_ADMIN has chosen to act on behalf of a tenant.
 */
export interface ActingAsClaim {
  tenantId: string;
  tenantName?: string;
  tenantSlug?: string;
  role: Role;
  impersonationId: string;
  startedAt: string; // ISO timestamp
}

/**
 * Subset of session shape we care about for effective-role resolution.
 * Compatible with the next-auth session.user object.
 */
export interface RoleSessionUser {
  id: string;
  role: Role;
  tenantId?: string | null;
  actingAs?: ActingAsClaim | null;
}

export interface EffectiveRole {
  /** The role that should be used for permission checks. */
  role: Role;
  /** The tenant the action is scoped to (null for platform-only actions). */
  tenantId: string | null;
  /** True when the actor is a platform admin currently impersonating. */
  isImpersonating: boolean;
  /** The real user id (always the platform admin's id when impersonating). */
  realUserId: string;
  /** The real role of the underlying user (PLATFORM_ADMIN when impersonating). */
  realRole: Role;
  /** When impersonating, the Impersonation record id; otherwise null. */
  impersonationId: string | null;
}

/**
 * Resolve the effective role + tenant context for a session.
 *
 * - Tenant users: returns their own role and tenantId.
 * - Platform admins NOT impersonating: returns PLATFORM_ADMIN with no tenant.
 * - Platform admins impersonating: returns the assumed role (e.g. TENANT_ADMIN)
 *   and the impersonated tenantId, but `realRole` and `realUserId` retain the
 *   actual identity for audit attribution.
 */
export function getEffectiveRole(user: RoleSessionUser): EffectiveRole {
  const realRole = user.role;
  const realUserId = user.id;

  if (user.actingAs) {
    return {
      role: user.actingAs.role,
      tenantId: user.actingAs.tenantId,
      isImpersonating: true,
      realUserId,
      realRole,
      impersonationId: user.actingAs.impersonationId,
    };
  }

  return {
    role: realRole,
    tenantId: user.tenantId ?? null,
    isImpersonating: false,
    realUserId,
    realRole,
    impersonationId: null,
  };
}
