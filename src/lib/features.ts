import { prisma } from "@/lib/prisma";
import { getEffectiveRole } from "@/lib/roles";
import { isPlatformFlag } from "@/lib/flags/keys";
import { getUnleash } from "@/lib/flags/unleash";
import { buildContext } from "@/lib/flags/context";
import type { AppSession } from "@/lib/api-utils";

/** Read a tenant's boolean flag from Postgres (default false). */
async function readPostgresFlag(tenantId: string, key: string): Promise<boolean> {
  const flag = await prisma.featureFlag.findUnique({
    where: { tenantId_key: { tenantId, key } },
  });
  return flag?.enabled ?? false;
}

/**
 * Check if a feature flag is enabled for a tenant.
 *
 * Router (#feature-management): PLATFORM flags resolve from Unleash when it is
 * configured; tenant-togglable, capability/preset, and unknown keys resolve from
 * Postgres. While Unleash is unconfigured (pre-cutover / dev / tests) every key
 * reads Postgres, so behaviour is unchanged.
 *
 * This signature has only `tenantId` — it evaluates with per-tenant stickiness
 * (a synthetic `tenant:<id>` userId) so percentage rollouts bucket deterministically
 * per tenant. For per-user targeting use {@link flagIsOn}.
 */
export async function isFeatureEnabled(tenantId: string, key: string): Promise<boolean> {
  if (isPlatformFlag(key)) {
    const unleash = getUnleash();
    if (unleash) {
      return unleash.isEnabled(key, {
        userId: `tenant:${tenantId}`,
        properties: { tenantId },
      });
    }
  }
  return readPostgresFlag(tenantId, key);
}

/**
 * Session-aware flag check for per-user / role / group / rollout targeting on
 * PLATFORM flags. Falls back to the tenant's Postgres boolean for Postgres-owned
 * keys or when Unleash is unconfigured.
 */
export async function flagIsOn(
  key: string,
  session: AppSession | null,
  req?: Request,
): Promise<boolean> {
  if (isPlatformFlag(key)) {
    const unleash = getUnleash();
    if (unleash) {
      const context = await buildContext(session, req);
      return unleash.isEnabled(key, context);
    }
  }

  // Postgres-owned flag, or Unleash unconfigured: read the tenant boolean.
  if (!session) return false;
  const eff = getEffectiveRole(session.user);
  const tenantId = eff.tenantId ?? session.user.tenantId ?? null;
  if (!tenantId) return false;
  return readPostgresFlag(tenantId, key);
}

/**
 * Evaluate several PLATFORM flags for one session, building the Unleash context
 * once (#feature-management). Non-platform keys are ignored — callers read those
 * from {@link getTenantFlags}. This is the many-keys companion to {@link flagIsOn}:
 * a dashboard nav load needs several platform flags at once, and evaluating them
 * via `flagIsOn` would rebuild the context (and re-query group membership) per key.
 *
 * When Unleash is unconfigured (pre-cutover / dev / tests) every key falls back to
 * the session's effective-tenant Postgres boolean, matching {@link flagIsOn}.
 */
export async function evaluatePlatformFlags(
  session: AppSession | null,
  req: Request | undefined,
  keys: readonly string[],
): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {};
  const platformKeys = keys.filter(isPlatformFlag);
  if (platformKeys.length === 0) return result;

  const unleash = getUnleash();
  if (unleash) {
    const context = await buildContext(session, req);
    for (const key of platformKeys) {
      result[key] = unleash.isEnabled(key, context);
    }
    return result;
  }

  // Unleash unconfigured: fall back to the session's effective-tenant booleans.
  const tenantId = session
    ? getEffectiveRole(session.user).tenantId ?? session.user.tenantId ?? null
    : null;
  for (const key of platformKeys) {
    result[key] = tenantId ? await readPostgresFlag(tenantId, key) : false;
  }
  return result;
}

/** Set a feature flag for a tenant (upsert). Postgres-owned flags only. */
export async function setFeatureFlag(tenantId: string, key: string, enabled: boolean) {
  return prisma.featureFlag.upsert({
    where: { tenantId_key: { tenantId, key } },
    update: { enabled },
    create: { tenantId, key, enabled },
  });
}

/** Get all flags for a tenant. */
export async function getTenantFlags(tenantId: string) {
  return prisma.featureFlag.findMany({ where: { tenantId } });
}

