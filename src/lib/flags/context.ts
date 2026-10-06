import type { Context } from "unleash-client";
import { prisma } from "@/lib/prisma";
import { getEffectiveRole } from "@/lib/roles";
import type { AppSession } from "@/lib/api-utils";

// Builds the Unleash evaluation Context from a session (#feature-management).
//
// Targeting primitives exposed to Unleash strategies:
//   - userId       → the EFFECTIVE user id (see the impersonation seam below).
//   - role         → the EFFECTIVE role (one of the 5 cohorts: GUEST / USER /
//                    MAINTENANCE / TENANT_ADMIN / PLATFORM_ADMIN).
//   - tenantId     → effective tenant (for per-tenant lists + stickiness).
//   - groups       → delimited `grp:<cuid>` tokens for CUSTOM permission groups
//                    only (built-in groups are redundant with `role`).
//
// `realRole` / `realUserId` are deliberately NOT emitted — exposing them would
// bleed platform-admin features into an impersonated view. They stay audit-only.

// Space-delimited so an Unleash STR_CONTAINS on a single `grp:<cuid>` token can't
// collide with a substring of another token.
const GROUP_TOKEN_DELIM = " ";

/** CUSTOM (non-built-in) permission-group tokens for a user within a tenant. */
async function customGroupTokens(userId: string, tenantId: string): Promise<string[]> {
  const rows = await prisma.groupMember.findMany({
    where: {
      membership: { userId, tenantId },
      group: { isBuiltIn: false },
    },
    select: { groupId: true },
  });
  return rows.map((r) => `grp:${r.groupId}`);
}

/**
 * Build the Unleash {@link Context} for a request.
 *
 * Unauthenticated callers map to the GUEST cohort with no user identity. The
 * **effectiveUserId seam**: under today's tenant+role impersonation we OMIT
 * `userId` (a platform admin impersonating a generic TENANT_ADMIN is not a real
 * user, so per-user rollouts must not attribute to them). When
 * `#impersonation-user-scope` lands this becomes the impersonated user's id and
 * per-user previews start working with no change here.
 */
export async function buildContext(
  session: AppSession | null,
  req?: Request,
): Promise<Context> {
  const remoteAddress = req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  if (!session) {
    const context: Context = { properties: { role: "GUEST" } };
    if (remoteAddress) context.remoteAddress = remoteAddress;
    return context;
  }

  const eff = getEffectiveRole(session.user);
  const tenantId = eff.tenantId ?? session.user.tenantId ?? undefined;
  const effectiveUserId = eff.isImpersonating ? undefined : session.user.id;

  const groups =
    effectiveUserId && tenantId
      ? (await customGroupTokens(effectiveUserId, tenantId)).join(GROUP_TOKEN_DELIM)
      : "";

  const properties: Record<string, string> = { role: eff.role };
  if (tenantId) properties.tenantId = tenantId;
  if (session.user.email) properties.email = session.user.email;
  if (groups) properties.groups = groups;

  const context: Context = { properties };
  if (effectiveUserId) context.userId = effectiveUserId;
  if (remoteAddress) context.remoteAddress = remoteAddress;
  return context;
}
