import { prisma } from "@/lib/prisma";
import type { Membership, MembershipKind, MembershipStatus, Role } from "@prisma/client";

export type MembershipWithTenant = Membership & {
  tenant: { id: string; name: string; slug: string; brandColor: string; status: string; active: boolean; locale: string };
};

/**
 * Return all of a user's memberships (any status) with their tenant joined.
 * Ordered by createdAt ascending so the lowest is the "primary" by convention.
 */
export async function getMembershipsForUser(userId: string): Promise<MembershipWithTenant[]> {
  return prisma.membership.findMany({
    where: { userId },
    include: {
      tenant: { select: { id: true, name: true, slug: true, brandColor: true, status: true, active: true, locality: true, locale: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

/** Active memberships only — what the user can act on right now. */
export async function getActiveMembershipsForUser(userId: string): Promise<MembershipWithTenant[]> {
  const all = await getMembershipsForUser(userId);
  return all.filter((m) => m.status === "ACTIVE");
}

/**
 * Pick the user's "primary" membership: the lowest-createdAt active membership.
 * Falls back to the lowest-createdAt of any status if none are active.
 * Returns null if the user has no memberships at all.
 */
export function pickPrimaryMembership(memberships: MembershipWithTenant[]): MembershipWithTenant | null {
  if (memberships.length === 0) return null;
  const active = memberships.filter((m) => m.status === "ACTIVE");
  if (active.length > 0) return active[0]; // already sorted by createdAt asc
  return memberships[0];
}

/** Find the membership of a user in a specific tenant (any status). */
export async function findMembership(userId: string, tenantId: string) {
  return prisma.membership.findUnique({ where: { userId_tenantId: { userId, tenantId } } });
}

/** True if the user has an ACTIVE membership in the given tenant. */
export async function userHasActiveMembershipIn(userId: string, tenantId: string): Promise<boolean> {
  const m = await findMembership(userId, tenantId);
  return !!m && m.status === "ACTIVE";
}

export type ResolvedActiveContext = {
  tenantId: string | null;
  role: Role;
  kind: MembershipKind | null;
  status: MembershipStatus | null;
  locale: string;
};

/**
 * Resolve the active tenant context for a user given an optional preferred
 * tenantId (e.g. from a JWT `activeTenantId` claim). If the preferred id
 * matches an active membership, use that; otherwise fall back to the primary.
 *
 * Returns nulls when the user has no memberships (e.g. platform admins).
 */
export async function resolveActiveContext(
  userId: string,
  preferredTenantId: string | null,
): Promise<ResolvedActiveContext> {
  const memberships = await getMembershipsForUser(userId);
  if (memberships.length === 0) {
    return { tenantId: null, role: "USER", kind: null, status: null, locale: "en" };
  }

  if (preferredTenantId) {
    const match = memberships.find((m) => m.tenantId === preferredTenantId && m.status === "ACTIVE");
    if (match) {
      return { tenantId: match.tenantId, role: match.role, kind: match.kind, status: match.status, locale: match.tenant.locale };
    }
  }

  const primary = pickPrimaryMembership(memberships);
  if (!primary) return { tenantId: null, role: "USER", kind: null, status: null, locale: "en" };
  return { tenantId: primary.tenantId, role: primary.role, kind: primary.kind, status: primary.status, locale: primary.tenant.locale };
}
