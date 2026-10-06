import type { CharityRegulator, CharityCategoryKind } from "@prisma/client";

/**
 * Default chart of accounts seeded per regulator on first use.
 *
 * Categories follow the published Receipts & Payments templates from each
 * regulator (CC E&W's CC16, OSCR's R&P workpack, CCNI's R&P toolkit).
 *
 * Codes here use a stable platform scheme (R01.. for receipts, P01.. for
 * payments) rather than the regulator's own line numbers. Trustees map
 * platform codes to regulator template lines at export time. This avoids
 * the codes drifting if a regulator renumbers their template, and keeps
 * the seed simple. A future enhancement could ship a per-regulator
 * code map; for MVP, the labels carry the meaning.
 *
 * Categories are deliberately broad, not exhaustive — a small bowling club
 * does not need 30 expense lines. Trustees can add their own categories
 * via the categories admin page.
 */

export type SeedCategory = {
  code: string;
  kind: CharityCategoryKind;
  label: string;
  sortOrder: number;
};

// Common categories used across all three regulators. Bowling-club leaning.
const COMMON_RECEIPTS: SeedCategory[] = [
  { code: "R01", kind: "RECEIPT", label: "Membership subscriptions", sortOrder: 10 },
  { code: "R02", kind: "RECEIPT", label: "Match & competition fees", sortOrder: 20 },
  { code: "R03", kind: "RECEIPT", label: "Green fees & visitor income", sortOrder: 30 },
  { code: "R04", kind: "RECEIPT", label: "Bar & catering income", sortOrder: 40 },
  { code: "R05", kind: "RECEIPT", label: "Fundraising & social events", sortOrder: 50 },
  { code: "R06", kind: "RECEIPT", label: "Donations & legacies", sortOrder: 60 },
  { code: "R07", kind: "RECEIPT", label: "Grants received", sortOrder: 70 },
  { code: "R08", kind: "RECEIPT", label: "Bank interest received", sortOrder: 80 },
  { code: "R09", kind: "RECEIPT", label: "Sale of assets", sortOrder: 90 },
  { code: "R99", kind: "RECEIPT", label: "Other income", sortOrder: 990 },
];

const COMMON_PAYMENTS: SeedCategory[] = [
  { code: "P01", kind: "PAYMENT", label: "Green & grounds maintenance", sortOrder: 10 },
  { code: "P02", kind: "PAYMENT", label: "Equipment purchase & repair", sortOrder: 20 },
  { code: "P03", kind: "PAYMENT", label: "Clubhouse repairs & maintenance", sortOrder: 30 },
  { code: "P04", kind: "PAYMENT", label: "Utilities (electricity, gas, water)", sortOrder: 40 },
  { code: "P05", kind: "PAYMENT", label: "Insurance", sortOrder: 50 },
  { code: "P06", kind: "PAYMENT", label: "Affiliation fees", sortOrder: 60 },
  { code: "P07", kind: "PAYMENT", label: "Bar & catering supplies", sortOrder: 70 },
  { code: "P08", kind: "PAYMENT", label: "Competition prizes & trophies", sortOrder: 80 },
  { code: "P09", kind: "PAYMENT", label: "Postage, printing & stationery", sortOrder: 90 },
  { code: "P10", kind: "PAYMENT", label: "Independent examination fee", sortOrder: 100 },
  { code: "P11", kind: "PAYMENT", label: "Bank charges", sortOrder: 110 },
  { code: "P12", kind: "PAYMENT", label: "Rates & rent", sortOrder: 120 },
  { code: "P13", kind: "PAYMENT", label: "Wages & honoraria", sortOrder: 130 },
  { code: "P14", kind: "PAYMENT", label: "Purchase of fixed assets", sortOrder: 140 },
  { code: "P99", kind: "PAYMENT", label: "Other expenditure", sortOrder: 990 },
];

/**
 * Get the default category seed for a regulator. v1 returns the same
 * common set for all three; per-regulator divergence (e.g. OSCR's
 * "Investment income" line) is a future enhancement.
 */
export function getCategorySeed(_regulator: CharityRegulator): SeedCategory[] {
  return [...COMMON_RECEIPTS, ...COMMON_PAYMENTS];
}
