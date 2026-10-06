import type { Country, OrganisationType, FundingOpportunity } from "@prisma/client";

type TenantProfile = {
  country: Country;
  organisationType: OrganisationType | null;
};

type ScoredOpportunity = {
  opportunityId: string;
  score: number; // 0–100
  reasons: string[];
};

/**
 * Score a single opportunity against a tenant profile.
 * Higher = better match. 0 = ineligible.
 */
export function scoreOpportunity(
  opp: Pick<FundingOpportunity, "id" | "orgTypes" | "countries" | "active">,
  tenant: TenantProfile,
): ScoredOpportunity {
  if (!opp.active) return { opportunityId: opp.id, score: 0, reasons: ["Opportunity is inactive"] };

  const reasons: string[] = [];
  let score = 50; // base score — available to all

  // Country match
  if (opp.countries.length > 0) {
    if (opp.countries.includes(tenant.country)) {
      score += 20;
      reasons.push("Available in your region");
    } else {
      return { opportunityId: opp.id, score: 0, reasons: ["Not available in your region"] };
    }
  } else {
    score += 10; // no restriction = mild positive
    reasons.push("Open to all regions");
  }

  // Org type match
  if (opp.orgTypes.length > 0) {
    if (tenant.organisationType && opp.orgTypes.includes(tenant.organisationType)) {
      score += 25;
      reasons.push("Matches your organisation type");
    } else if (!tenant.organisationType) {
      score += 5; // unknown org type — don't exclude, just lower confidence
      reasons.push("Set your organisation type for better matching");
    } else {
      return { opportunityId: opp.id, score: 0, reasons: ["Not eligible for your organisation type"] };
    }
  } else {
    score += 10;
    reasons.push("Open to all organisation types");
  }

  return { opportunityId: opp.id, score: Math.min(score, 100), reasons };
}

/**
 * Score and rank a list of opportunities for a tenant.
 * Returns only eligible opportunities (score > 0), sorted by score desc.
 */
export function rankOpportunities(
  opportunities: Pick<FundingOpportunity, "id" | "orgTypes" | "countries" | "active">[],
  tenant: TenantProfile,
): ScoredOpportunity[] {
  return opportunities
    .map((opp) => scoreOpportunity(opp, tenant))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}
