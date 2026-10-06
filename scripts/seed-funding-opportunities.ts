// Seed curated funding opportunities into the platform catalogue.
// These are platform-level (tenantId = null) so all clubs can see them.
//
// Usage:
//   npx tsx scripts/seed-funding-opportunities.ts          -> upserts all opportunities
//   npx tsx scripts/seed-funding-opportunities.ts --clean   -> deletes platform opportunities first

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { OrganisationType, Country } from "@prisma/client";

type OpportunitySeed = {
  name: string;
  funder: string;
  description: string;
  url: string;
  eligibilityNotes: string;
  deadline: Date | null;
  maxAmount: number | null; // pence
  minAmount: number | null; // pence
  tags: string[];
  orgTypes: OrganisationType[];
  countries: Country[];
  reapplyIntervalMonths: number | null; // funder-published cadence
  questions: { label: string; helpText?: string }[];
};

const OPPORTUNITIES: OpportunitySeed[] = [
  {
    name: "Community Asset Fund",
    funder: "Sport England",
    description:
      "Capital and revenue funding to protect, improve, or create sporting assets that are at the heart of communities.",
    url: "https://www.sportengland.org/funds-and-campaigns/community-asset-fund",
    eligibilityNotes:
      "Open to clubs, charities, community organisations, and local authorities. Must demonstrate community need and align with Sport England outcomes.",
    deadline: null, // rolling
    maxAmount: 1_500_000_00, // £1.5m
    minAmount: 1_000_00, // £1,000
    tags: ["facility", "capital", "community"],
    orgTypes: [],
    countries: ["GB"],
    reapplyIntervalMonths: null, // rolling fund, no published minimum
    questions: [
      { label: "Describe your organisation and its purpose", helpText: "Include charity/company number if applicable." },
      { label: "What is the project you need funding for?", helpText: "Describe the asset, improvement, or facility." },
      { label: "How does this project meet a community need?", helpText: "Reference local evidence or consultation." },
      { label: "Provide a breakdown of how the funds will be used" },
      { label: "What other funding have you secured or applied for?" },
      { label: "How will you measure success?" },
    ],
  },
  {
    name: "Small Grants",
    funder: "Sport England",
    description:
      "Revenue funding for projects that grow and sustain the number of people playing sport or getting active, particularly from under-represented groups.",
    url: "https://www.sportengland.org/funds-and-campaigns/small-grants",
    eligibilityNotes: "For organisations with a core sporting purpose. Awards typically £300–£10,000.",
    deadline: null, // rolling
    maxAmount: 10_000_00, // £10,000
    minAmount: 300_00,
    tags: ["participation", "revenue", "inclusion"],
    orgTypes: [],
    countries: ["GB"],
    reapplyIntervalMonths: null, // rolling fund, no published minimum
    questions: [
      { label: "Describe your organisation and its purpose" },
      { label: "What activity will this funding support?" },
      { label: "Who will benefit and how many people?" },
      { label: "How will you reach under-represented groups?" },
      { label: "Provide a budget breakdown" },
    ],
  },
  {
    name: "Club Development Grants",
    funder: "Bowls England",
    description:
      "Grants to affiliated clubs for projects that grow participation, improve coaching, or enhance facilities.",
    url: "https://www.bowlsengland.com",
    eligibilityNotes: "Must be a Bowls England affiliated club. Priority given to clubs with development plans.",
    deadline: null,
    maxAmount: 2_000_00, // £2,000
    minAmount: 250_00,
    tags: ["bowls", "participation", "coaching", "facility"],
    orgTypes: [],
    countries: ["GB"],
    reapplyIntervalMonths: 12, // annual programme
    questions: [
      { label: "Club name and Bowls England affiliation number" },
      { label: "Describe the project or activity" },
      { label: "How many participants will benefit?" },
      { label: "How does this align with your club development plan?" },
      { label: "Provide a cost breakdown" },
    ],
  },
  {
    name: "Awards for All",
    funder: "National Lottery Community Fund",
    description:
      "Quick and easy funding for small, community-led projects that bring people together, improve places, and help people reach their potential.",
    url: "https://www.tnlcommunityfund.org.uk/funding/programmes/national-lottery-awards-for-all-england",
    eligibilityNotes:
      "Open to voluntary/community organisations, registered charities, CIOs, CASCs, schools, and local authorities. Must benefit the community.",
    deadline: null, // rolling
    maxAmount: 10_000_00,
    minAmount: 300_00,
    tags: ["community", "participation", "revenue"],
    orgTypes: [
      "REGISTERED_CHARITY", "CIO", "CASC", "UNINCORPORATED_ASSOCIATION",
    ],
    countries: ["GB"],
    reapplyIntervalMonths: 12, // cannot reapply within 12 months of a previous award
    questions: [
      { label: "What would you like to do?", helpText: "Describe your project in plain language." },
      { label: "How does your project meet the needs of your community?" },
      { label: "How many people will benefit and how?" },
      { label: "How much funding do you need and what will it pay for?" },
      { label: "How will your project be managed and delivered?" },
    ],
  },
  {
    name: "Awards for All — Scotland",
    funder: "National Lottery Community Fund",
    description:
      "Funding for projects that bring people together, improve places, or help people and communities thrive in Scotland.",
    url: "https://www.tnlcommunityfund.org.uk/funding/programmes/national-lottery-awards-for-all-scotland",
    eligibilityNotes:
      "Scottish-based organisations. Must be a voluntary/community group, registered charity, SCIO, or CASC.",
    deadline: null,
    maxAmount: 10_000_00,
    minAmount: 300_00,
    tags: ["community", "participation", "revenue", "scotland"],
    orgTypes: ["REGISTERED_CHARITY", "SCIO", "CASC", "UNINCORPORATED_ASSOCIATION"],
    countries: ["GB"],
    reapplyIntervalMonths: 12,
    questions: [
      { label: "What would you like to do?" },
      { label: "How does your project meet community needs?" },
      { label: "Who will benefit?" },
      { label: "Budget breakdown" },
    ],
  },
  {
    name: "Awards for All — Northern Ireland",
    funder: "National Lottery Community Fund",
    description: "Funding for communities in Northern Ireland.",
    url: "https://www.tnlcommunityfund.org.uk/funding/programmes/awards-for-all-northern-ireland",
    eligibilityNotes: "Northern Ireland-based organisations.",
    deadline: null,
    maxAmount: 10_000_00,
    minAmount: 300_00,
    tags: ["community", "participation", "revenue"],
    orgTypes: ["REGISTERED_CHARITY", "CIO", "CASC", "UNINCORPORATED_ASSOCIATION"],
    countries: ["NI"],
    reapplyIntervalMonths: 12,
    questions: [
      { label: "What would you like to do?" },
      { label: "How does your project meet community needs?" },
      { label: "Who will benefit?" },
      { label: "Budget breakdown" },
    ],
  },
  {
    name: "Landfill Communities Fund",
    funder: "ENTRUST (various distributors)",
    description:
      "Funding from landfill tax credits for community and environmental projects within qualifying distance of a landfill or transfer station.",
    url: "https://www.entrust.org.uk",
    eligibilityNotes:
      "Must be a registered charity or CASC. Project site must be within a qualifying area. Multiple distributors (e.g. WREN, Biffa Award, Viridor Credits).",
    deadline: null,
    maxAmount: 50_000_00,
    minAmount: 5_000_00,
    tags: ["facility", "capital", "environment"],
    orgTypes: ["REGISTERED_CHARITY", "CIO", "CASC"],
    countries: ["GB"],
    reapplyIntervalMonths: null,
    questions: [
      { label: "Describe your organisation" },
      { label: "Describe the project and its environmental benefit" },
      { label: "Confirm the project is within a qualifying area" },
      { label: "How much third-party funding have you secured?", helpText: "LCF typically requires 10% third-party contribution." },
      { label: "Project budget and timeline" },
    ],
  },
  {
    name: "Power to Change — Community Business Fund",
    funder: "Power to Change",
    description:
      "Grants for community businesses — organisations that trade for the benefit of their local community and are accountable to it.",
    url: "https://www.powertochange.org.uk",
    eligibilityNotes:
      "Must be a community business (community-owned, trading, accountable to the community). CICs, co-ops, charities, CASCs eligible.",
    deadline: null,
    maxAmount: 100_000_00,
    minAmount: 10_000_00,
    tags: ["community", "capital", "revenue", "sustainability"],
    orgTypes: ["REGISTERED_CHARITY", "CIO", "COMMUNITY_INTEREST_COMPANY", "CASC"],
    countries: ["GB"],
    reapplyIntervalMonths: null,
    questions: [
      { label: "Describe your community business" },
      { label: "How is your organisation accountable to the community?" },
      { label: "What will this grant fund?" },
      { label: "What is your trading income?" },
      { label: "How will you sustain this beyond the grant period?" },
    ],
  },
  {
    name: "Local Authority Sport Grant (generic template)",
    funder: "Your Local Authority",
    description:
      "Many local authorities offer small grants for sport and recreation. Search your council's website for current schemes.",
    url: "",
    eligibilityNotes:
      "Varies by council. Usually open to voluntary and community groups, sometimes limited to registered charities or CASCs. Check your local authority.",
    deadline: null,
    maxAmount: 5_000_00,
    minAmount: 500_00,
    tags: ["participation", "revenue", "local"],
    orgTypes: [],
    countries: ["GB", "NI"],
    reapplyIntervalMonths: null,
    questions: [
      { label: "Describe your organisation" },
      { label: "What activity or project will the grant support?" },
      { label: "How many local people will benefit?" },
      { label: "How much are you requesting and what will it cover?" },
    ],
  },
];

async function main() {
  const clean = process.argv.includes("--clean");

  if (clean) {
    const deleted = await prisma.fundingOpportunity.deleteMany({
      where: { tenantId: null },
    });
    console.log(`Deleted ${deleted.count} platform opportunities.`);
  }

  for (const opp of OPPORTUNITIES) {
    // Upsert by name+funder (platform-level)
    const existing = await prisma.fundingOpportunity.findFirst({
      where: { name: opp.name, funder: opp.funder, tenantId: null },
    });

    if (existing) {
      await prisma.fundingOpportunity.update({
        where: { id: existing.id },
        data: {
          description: opp.description,
          url: opp.url || null,
          eligibilityNotes: opp.eligibilityNotes,
          deadline: opp.deadline,
          maxAmount: opp.maxAmount,
          minAmount: opp.minAmount,
          tags: opp.tags,
          orgTypes: opp.orgTypes,
          countries: opp.countries,
          reapplyIntervalMonths: opp.reapplyIntervalMonths,
        },
      });
      console.log(`Updated: ${opp.name} (${opp.funder})`);
    } else {
      await prisma.fundingOpportunity.create({
        data: {
          tenantId: null,
          name: opp.name,
          funder: opp.funder,
          description: opp.description,
          url: opp.url || null,
          eligibilityNotes: opp.eligibilityNotes,
          deadline: opp.deadline,
          maxAmount: opp.maxAmount,
          minAmount: opp.minAmount,
          tags: opp.tags,
          orgTypes: opp.orgTypes,
          countries: opp.countries,
          reapplyIntervalMonths: opp.reapplyIntervalMonths,
          questions: {
            create: opp.questions.map((q, i) => ({
              label: q.label,
              helpText: q.helpText ?? null,
              sortOrder: i,
            })),
          },
        },
      });
      console.log(`Created: ${opp.name} (${opp.funder})`);
    }
  }

  console.log(`\nDone. ${OPPORTUNITIES.length} opportunities seeded.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
