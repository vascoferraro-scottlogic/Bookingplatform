import type { CharityRegulator } from "@prisma/client";

/**
 * TAR section definitions per regulator.
 *
 * Each section maps to a key in the CharityTAR.sections JSON blob.
 * `dataKeys` lists the context data buckets the LLM prompt should
 * include when generating a suggestion for this section — see Phase B
 * (GET /api/charity/tar/context) for the shape of each bucket.
 *
 * Regulators:
 *   CC_EW  — Charity Commission for England & Wales (CC15d / CC16a)
 *   OSCR   — Office of the Scottish Charity Regulator (OSCR Annual Return)
 *   CCNI   — Charity Commission for Northern Ireland (Annual Monitoring Return)
 */

export type TARSection = {
  slug: string;
  title: string;
  guidance: string; // short prompt for the trustee / LLM
  dataKeys: string[]; // context buckets from /api/charity/tar/context
  required: boolean;
};

// ── CC E&W sections (CC15d guidance) ────────────────────────

const CC_EW_SECTIONS: TARSection[] = [
  {
    slug: "reference-admin",
    title: "Reference & administrative details",
    guidance:
      "Charity name, registration number, address, trustees, bankers, independent examiner.",
    dataKeys: ["charitySettings", "trustees"],
    required: true,
  },
  {
    slug: "objectives",
    title: "Objectives & activities",
    guidance:
      "State the charity's purposes as set out in its governing document and the main activities undertaken to further those purposes.",
    dataKeys: ["charitySettings"],
    required: true,
  },
  {
    slug: "achievements",
    title: "Achievements & performance",
    guidance:
      "Summarise the main achievements during the year. Mention events held, community engagement, competitions, coaching sessions, and any outreach.",
    dataKeys: ["events", "bookings", "streaming", "members"],
    required: true,
  },
  {
    slug: "financial-review",
    title: "Financial review",
    guidance:
      "Summarise income and expenditure for the year, comment on any significant changes, and describe the charity's reserves position.",
    dataKeys: ["financials", "charitySettings"],
    required: true,
  },
  {
    slug: "reserves-policy",
    title: "Reserves policy",
    guidance:
      "Describe the charity's policy on reserves, the level of reserves held, and why.",
    dataKeys: ["financials", "charitySettings"],
    required: true,
  },
  {
    slug: "public-benefit",
    title: "Public benefit statement",
    guidance:
      "Explain how the charity's activities have provided public benefit, with reference to Charity Commission guidance.",
    dataKeys: ["events", "bookings", "members", "charitySettings"],
    required: true,
  },
  {
    slug: "structure-governance",
    title: "Structure, governance & management",
    guidance:
      "Describe how the charity is constituted, how trustees are appointed, and any training or induction for new trustees.",
    dataKeys: ["charitySettings", "trustees"],
    required: true,
  },
  {
    slug: "plans",
    title: "Plans for future periods",
    guidance:
      "Outline the charity's plans and objectives for the coming year.",
    dataKeys: ["maintenance"],
    required: false,
  },
];

// ── OSCR sections (Scottish Annual Return) ──────────────────

const OSCR_SECTIONS: TARSection[] = [
  {
    slug: "reference-admin",
    title: "Reference & administrative information",
    guidance:
      "Charity name, OSCR number, principal address, trustees, advisers.",
    dataKeys: ["charitySettings", "trustees"],
    required: true,
  },
  {
    slug: "objectives",
    title: "Charitable purposes",
    guidance:
      "State the charity's purposes as set out in its constitution.",
    dataKeys: ["charitySettings"],
    required: true,
  },
  {
    slug: "achievements",
    title: "Activities & achievements",
    guidance:
      "Describe the activities carried out in the year and how they furthered the charity's purposes. Include events, competitions, coaching, and community outreach.",
    dataKeys: ["events", "bookings", "streaming", "members"],
    required: true,
  },
  {
    slug: "financial-review",
    title: "Financial review",
    guidance:
      "Summarise income, expenditure, and the charity's financial position at year-end.",
    dataKeys: ["financials", "charitySettings"],
    required: true,
  },
  {
    slug: "reserves-policy",
    title: "Reserves policy",
    guidance:
      "Describe the charity's reserves policy and the current level of reserves.",
    dataKeys: ["financials", "charitySettings"],
    required: true,
  },
  {
    slug: "public-benefit",
    title: "Provision of public benefit",
    guidance:
      "Explain the benefit the charity has provided to the public, referencing the charity test under the 2005 Act.",
    dataKeys: ["events", "bookings", "members", "charitySettings"],
    required: true,
  },
  {
    slug: "structure-governance",
    title: "Governance & management",
    guidance:
      "Describe the charity's governance structure, how trustees are recruited and trained.",
    dataKeys: ["charitySettings", "trustees"],
    required: true,
  },
  {
    slug: "plans",
    title: "Future plans",
    guidance: "Outline plans for the next reporting period.",
    dataKeys: ["maintenance"],
    required: false,
  },
];

// ── CCNI sections (NI Annual Monitoring Return) ─────────────

const CCNI_SECTIONS: TARSection[] = [
  {
    slug: "reference-admin",
    title: "Reference & administrative details",
    guidance:
      "Charity name, CCNI registration number, address, trustees, bankers, independent examiner.",
    dataKeys: ["charitySettings", "trustees"],
    required: true,
  },
  {
    slug: "objectives",
    title: "Purposes & aims",
    guidance:
      "State the charity's purposes and aims as set out in its governing document.",
    dataKeys: ["charitySettings"],
    required: true,
  },
  {
    slug: "achievements",
    title: "Summary of main activities",
    guidance:
      "Summarise main activities and achievements during the year. Include events, community use, coaching, and outreach.",
    dataKeys: ["events", "bookings", "streaming", "members"],
    required: true,
  },
  {
    slug: "financial-review",
    title: "Financial review",
    guidance:
      "Provide an overview of income, expenditure, and financial position.",
    dataKeys: ["financials", "charitySettings"],
    required: true,
  },
  {
    slug: "reserves-policy",
    title: "Reserves policy",
    guidance:
      "Describe the reserves policy and level of reserves.",
    dataKeys: ["financials", "charitySettings"],
    required: true,
  },
  {
    slug: "public-benefit",
    title: "Public benefit",
    guidance:
      "Explain how the charity's activities benefit the public, with reference to CCNI guidance on the public benefit requirement.",
    dataKeys: ["events", "bookings", "members", "charitySettings"],
    required: true,
  },
  {
    slug: "structure-governance",
    title: "Structure, governance & management",
    guidance:
      "Describe how the charity is constituted, governed, and managed.",
    dataKeys: ["charitySettings", "trustees"],
    required: true,
  },
  {
    slug: "plans",
    title: "Plans for future periods",
    guidance: "Set out plans for the next period.",
    dataKeys: ["maintenance"],
    required: false,
  },
];

// ── Lookup ───────────────────────────────────────────────────

const SECTIONS_BY_REGULATOR: Record<CharityRegulator, TARSection[]> = {
  CC_EW: CC_EW_SECTIONS,
  OSCR: OSCR_SECTIONS,
  CCNI: CCNI_SECTIONS,
};

/** Return the ordered TAR sections for the given regulator. */
export function getTARSections(regulator: CharityRegulator): TARSection[] {
  return SECTIONS_BY_REGULATOR[regulator];
}

/** All unique data-context keys across all regulators (for aggregation). */
export function allDataKeys(): string[] {
  const keys = new Set<string>();
  for (const sections of Object.values(SECTIONS_BY_REGULATOR)) {
    for (const s of sections) {
      for (const k of s.dataKeys) keys.add(k);
    }
  }
  return [...keys];
}
