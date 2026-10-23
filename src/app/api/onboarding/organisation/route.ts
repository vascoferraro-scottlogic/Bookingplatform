import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  assertEffectiveRoleOrFail,
  getSessionOrFail,
  jsonError,
} from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { isFeatureEnabled, setFeatureFlag } from "@/lib/features";
import { seedCharityDefaults } from "@/lib/charity/seed";
import { CHARITY_FEATURE_KEY, isCharityEligible } from "@/lib/charity/feature-gate";
import type { Country, OrganisationType, CharityRegulator, Vertical } from "@prisma/client";

const ALLOWED_COUNTRIES = new Set<Country>(["GB", "NI", "OTHER"]);
const ALLOWED_ORG_TYPES = new Set<OrganisationType>([
  "REGISTERED_CHARITY",
  "CIO",
  "SCIO",
  "CASC",
  "COMMUNITY_INTEREST_COMPANY",
  "LIMITED_COMPANY",
  "UNINCORPORATED_ASSOCIATION",
  "PRIVATE_MEMBERS_CLUB",
  "OTHER",
  "NOT_CONSTITUTED",
]);
const ALLOWED_VERTICALS = new Set<Vertical>([
  "BOWLS", "GOLF", "CRICKET", "MULTI_SPORT", "CHARITY_ADMIN", "OTHER",
]);
// Verticals that don't use the bookings or maintenance-agent capability.
const ADMIN_ONLY_VERTICALS = new Set<Vertical>(["CHARITY_ADMIN"]);

/**
 * Infer the most likely regulator from country + org type. SCIO is always
 * OSCR regardless of country tag (Scotland isn't its own country code in our
 * enum). NI is always CCNI. GB defaults to CC E&W and the admin can change
 * it in CharitySettings if their charity is OSCR-registered.
 */
function inferRegulator(
  country: Country,
  organisationType: OrganisationType,
): CharityRegulator | null {
  if (country === "OTHER") return null;
  if (country === "NI") return "CCNI";
  if (organisationType === "SCIO") return "OSCR";
  return "CC_EW";
}

/**
 * PATCH /api/onboarding/organisation
 *
 * Single endpoint for chapter 2 ("Your organisation"). Persists the KYC
 * answers AND fires the side-effects in one place: enabling the `charity`
 * feature flag for charity legal forms (not CASC) in supported jurisdictions, and
 * seeding CharitySettings + chart of accounts so the charity dashboard is
 * usable on first visit.
 *
 * Idempotent: re-PATCHing with the same answers is a no-op for the side
 * effects (flag set is upsert; settings upsert; seedCharityDefaults filters
 * existing rows). The flag is recomputed from the legal form on every save: it is
 * switched OFF when the tenant is no longer charity-eligible. Recorded charity
 * data is kept, only access is withdrawn.
 *
 * See plan: /memories/session/plan.md (Onboarding KYC).
 */
export async function PATCH(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  let body: {
    country?: string;
    organisationType?: string;
    financialYearEndMonth?: number;
    financialYearEndDay?: number;
    vertical?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  if (!body.country || !ALLOWED_COUNTRIES.has(body.country as Country)) {
    return jsonError(`country required, one of ${[...ALLOWED_COUNTRIES].join(", ")}`);
  }
  if (
    !body.organisationType ||
    !ALLOWED_ORG_TYPES.has(body.organisationType as OrganisationType)
  ) {
    return jsonError(
      `organisationType required, one of ${[...ALLOWED_ORG_TYPES].join(", ")}`,
    );
  }
  const m = body.financialYearEndMonth;
  if (typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > 12) {
    return jsonError("financialYearEndMonth must be an integer 1..12");
  }
  const d = body.financialYearEndDay;
  if (typeof d !== "number" || !Number.isInteger(d) || d < 1 || d > 31) {
    return jsonError("financialYearEndDay must be an integer 1..31");
  }

  const country = body.country as Country;
  const organisationType = body.organisationType as OrganisationType;
  const vertical: Vertical | undefined =
    body.vertical && ALLOWED_VERTICALS.has(body.vertical as Vertical)
      ? (body.vertical as Vertical)
      : undefined;

  // Snapshot the previous values for the audit meta so the trail shows the
  // delta, not just the new state.
  const before = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      country: true,
      organisationType: true,
      financialYearEndMonth: true,
      financialYearEndDay: true,
      vertical: true,
    },
  });
  if (!before) return jsonError("Tenant not found", 404);

  const tenant = await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      country,
      organisationType,
      financialYearEndMonth: m,
      financialYearEndDay: d,
      ...(vertical ? { vertical } : {}),
    },
  });

  // Side-effect: set capability flags based on vertical.
  // CHARITY_ADMIN → bookings off, agent off. Sports verticals → both on.
  // These are set idempotently via upsert so re-saving the chapter is safe.
  if (vertical) {
    const isAdminOnly = ADMIN_ONLY_VERTICALS.has(vertical);
    await setFeatureFlag(tenantId, "bookings", !isAdminOnly);
    await setFeatureFlag(tenantId, "agent", !isAdminOnly);
    if (isAdminOnly) {
      // Ensure funding is on for admin-only orgs (charity admin relies on it)
      await setFeatureFlag(tenantId, "funding", true);
    }
  }

  // Side-effect: charity-style org in a supported jurisdiction → enable the
  // feature and prepare CharitySettings + chart of accounts.
  let charityEnabled = false;
  let charitySettingsSeeded = false;
  if (isCharityEligible(country, organisationType)) {
    await setFeatureFlag(tenantId, CHARITY_FEATURE_KEY, true);
    charityEnabled = true;

    const existing = await prisma.charitySettings.findUnique({ where: { tenantId } });
    if (!existing) {
      const regulator = inferRegulator(country, organisationType);
      // regulator is non-null here because the country is GB or NI.
      if (regulator) {
        await prisma.charitySettings.create({
          data: {
            tenantId,
            regulator,
            yearEndMonth: m,
            yearEndDay: d,
          },
        });
        await seedCharityDefaults(tenantId, regulator);
        charitySettingsSeeded = true;
      }
    }
  } else if (await isFeatureEnabled(tenantId, CHARITY_FEATURE_KEY)) {
    // No longer eligible (e.g. legal form changed): switch charity off.
    await setFeatureFlag(tenantId, CHARITY_FEATURE_KEY, false);
  }

  logAudit({
    session,
    action: "tenant.organisation.set",
    entity: "Tenant",
    entityId: tenantId,
    tenantId,
    meta: {
      before: {
        country: before.country,
        organisationType: before.organisationType,
        financialYearEndMonth: before.financialYearEndMonth,
        financialYearEndDay: before.financialYearEndDay,
        vertical: before.vertical,
      },
      after: {
        country,
        organisationType,
        financialYearEndMonth: m,
        financialYearEndDay: d,
        vertical: vertical ?? before.vertical,
      },
      sideEffects: { charityEnabled, charitySettingsSeeded },
    },
  });

  return NextResponse.json({
    tenant: {
      id: tenant.id,
      country: tenant.country,
      organisationType: tenant.organisationType,
      financialYearEndMonth: tenant.financialYearEndMonth,
      financialYearEndDay: tenant.financialYearEndDay,
      vertical: tenant.vertical,
    },
    charityEnabled,
    charitySettingsSeeded,
  });
}
