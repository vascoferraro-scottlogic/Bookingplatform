import type { Country } from "@prisma/client";
import { isFeatureEnabled } from "@/lib/features";
import { prisma } from "@/lib/prisma";

/** Feature flag key for the Charity Accounts module. */
export const CHARITY_FEATURE_KEY = "charity";

/** Countries where the Charity Accounts module is supported. */
export const CHARITY_SUPPORTED_COUNTRIES: Country[] = ["GB", "NI"];

export type CharityGateFailure =
  | { ok: false; reason: "TENANT_NOT_FOUND" }
  | { ok: false; reason: "COUNTRY_UNSUPPORTED"; country: Country }
  | { ok: false; reason: "FEATURE_DISABLED" };

export type CharityGateResult =
  | { ok: true; tenantId: string; country: Country }
  | CharityGateFailure;

/**
 * Two-axis gate for Charity Accounts: country must be in the supported set
 * AND the `charity` feature flag must be enabled. Both required.
 *
 * Country is platform-admin-controlled (a fact about the tenant); the flag is
 * tenant-admin-controlled (a choice about whether to use the module). See
 * decisions log 2026-05-03 (country gate; CASC distinction).
 *
 * Use at the top of every charity API route after `assertEffectiveRoleOrFail`.
 * Returns `{ ok: true, ... }` on pass; otherwise a structured failure the
 * route handler can map to a 4xx response.
 */
export async function checkCharityGate(tenantId: string): Promise<CharityGateResult> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, country: true },
  });
  if (!tenant) return { ok: false, reason: "TENANT_NOT_FOUND" };
  if (!CHARITY_SUPPORTED_COUNTRIES.includes(tenant.country)) {
    return { ok: false, reason: "COUNTRY_UNSUPPORTED", country: tenant.country };
  }
  const enabled = await isFeatureEnabled(tenantId, CHARITY_FEATURE_KEY);
  if (!enabled) return { ok: false, reason: "FEATURE_DISABLED" };
  return { ok: true, tenantId: tenant.id, country: tenant.country };
}
