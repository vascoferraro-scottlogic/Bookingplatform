// Dev helper: drop fake MAINTENANCE_TASK_CREATE proposals into the inbox so
// ye can click through /dashboard/agents/inbox without an LLM key set.
//
// Usage:
//   npx tsx scripts/seed-fake-proposals.ts                 -> seeds into first active tenant
//   npx tsx scripts/seed-fake-proposals.ts <tenant-slug>   -> seeds into that tenant
//   npx tsx scripts/seed-fake-proposals.ts --clean         -> deletes prior fake runs in all tenants
//   npx tsx scripts/seed-fake-proposals.ts <slug> --clean  -> clean then re-seed for that tenant
//
// Each invocation creates ONE synthetic AgentRun tagged mode=MANUAL with a
// "fake-seed" marker in summary, and inserts a varied batch of PENDING
// proposals so the inbox shows the full range (low/med/high/urgent,
// different categories, with/without tone, with/without cluster).
//
// Re-runnable: --clean removes only runs we created (matched by summary tag);
// nothing else is touched. Approving/rejecting seeded proposals goes through
// the real committer/audit path so ye can validate the loop end-to-end.

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  TaskCategory,
  TaskPriority,
  AgentScope,
  AgentRunMode,
  AgentRunStatus,
  AgentProposalAudience,
  AgentProposalStatus,
} from "@prisma/client";

const FAKE_SEED_TAG = "fake-seed";

type FakeProposal = {
  title: string;
  description: string;
  category: TaskCategory;
  priority: TaskPriority;
  participantCount?: number;
  toneSeverity?: number;
  toneLabel?: string;
  confidence: number;
  reasoning: string;
};

const FAKE_PROPOSALS: FakeProposal[] = [
  {
    title: "Rink 3 surface uneven near the ditch end",
    description:
      "Multiple members reported the wood drifting on rink 3 — bias is fighting them all the way down. Worst near the ditch end after Tuesday's downpour.",
    category: TaskCategory.RINK_SURFACE,
    priority: TaskPriority.HIGH,
    participantCount: 4,
    toneSeverity: 0.7,
    toneLabel: "frustrated",
    confidence: 0.86,
    reasoning:
      "Four distinct authors over 90 minutes mentioning rink 3 + bias problems. Recurring topic across two channels.",
  },
  {
    title: "Pavilion gents toilet flush broken",
    description:
      "Gents toilet on the pavilion side won't flush properly — needs a new fill valve by the look of it.",
    category: TaskCategory.FACILITIES,
    priority: TaskPriority.MEDIUM,
    participantCount: 1,
    toneSeverity: 0.3,
    toneLabel: "matter-of-fact",
    confidence: 0.78,
    reasoning: "Single message, clear actionable detail, no ambiguity.",
  },
  {
    title: "Mower 2 making grinding noise — safety concern",
    description:
      "Greenkeeper flagged that the second mower is making a metal-on-metal grinding noise from the rear axle. Should be off the green until checked.",
    category: TaskCategory.SAFETY,
    priority: TaskPriority.URGENT,
    participantCount: 2,
    toneSeverity: 1.0,
    toneLabel: "alarmed",
    confidence: 0.94,
    reasoning:
      "Safety-critical keyword (grinding/axle), MAINTENANCE-role author, second member confirmed.",
  },
  {
    title: "Suggestion: longer evening sessions in summer",
    description:
      "A few members have asked whether we can extend opening hours to 9pm during peak summer. Worth a discussion.",
    category: TaskCategory.GENERAL,
    priority: TaskPriority.LOW,
    participantCount: 3,
    toneSeverity: 0.1,
    toneLabel: "constructive",
    confidence: 0.62,
    reasoning: "Suggestion-shaped, low urgency. Three distinct members raised it across the week.",
  },
  {
    title: "Hedge along east boundary needs cutting back",
    description:
      "The hedge running along the east boundary has overgrown the path — members are getting scratched walking past on the way to the car park.",
    category: TaskCategory.GROUNDS,
    priority: TaskPriority.MEDIUM,
    participantCount: 2,
    toneSeverity: 0.5,
    toneLabel: "concerned",
    confidence: 0.81,
    reasoning: "Two members in different channels referenced the east boundary hedge in the last 3 days.",
  },
];

async function clean() {
  // Find every fake-seed run we ever created and cascade-delete (proposals
  // and decisions FK on runId with onDelete: Cascade — see schema).
  const runs = await prisma.agentRun.findMany({
    where: { summary: { contains: FAKE_SEED_TAG } },
    select: { id: true, tenantId: true },
  });
  if (runs.length === 0) {
    console.log("No fake-seed runs found.");
    return 0;
  }
  await prisma.agentRun.deleteMany({ where: { id: { in: runs.map((r) => r.id) } } });
  console.log(`Deleted ${runs.length} fake-seed run(s) and cascaded their proposals.`);
  return runs.length;
}

async function seedForTenant(tenantSlug?: string) {
  const tenant = tenantSlug
    ? await prisma.tenant.findUnique({ where: { slug: tenantSlug } })
    : await prisma.tenant.findFirst({ where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  if (!tenant) {
    throw new Error(tenantSlug ? `No tenant with slug=${tenantSlug}` : "No active tenant found");
  }

  const detector = await prisma.agentDefinition.findUnique({ where: { slug: "detector" } });
  if (!detector) {
    throw new Error("No 'detector' AgentDefinition. Run `npm run db:seed` first.");
  }

  const run = await prisma.agentRun.create({
    data: {
      agentId: detector.id,
      tenantId: tenant.id,
      scope: AgentScope.TENANT,
      mode: AgentRunMode.MANUAL,
      status: AgentRunStatus.COMPLETED,
      completedAt: new Date(),
      summary: JSON.stringify({
        [FAKE_SEED_TAG]: true,
        note: "Fake proposals for inbox UI testing. Safe to delete via --clean.",
        proposalsEmitted: FAKE_PROPOSALS.length,
      }),
      provider: "stub",
      model: "fake-seed",
    },
  });

  let inserted = 0;
  for (const p of FAKE_PROPOSALS) {
    const { confidence, reasoning, ...payload } = p;
    await prisma.agentProposal.create({
      data: {
        agentId: detector.id,
        runId: run.id,
        kind: "MAINTENANCE_TASK_CREATE",
        payload: JSON.stringify(payload),
        confidence,
        reasoning,
        audienceScope: AgentProposalAudience.TENANT,
        tenantId: tenant.id,
        status: AgentProposalStatus.PENDING,
      },
    });
    inserted++;
  }

  console.log(
    `Seeded ${inserted} PENDING proposal(s) into tenant '${tenant.slug}' (${tenant.name}).`,
  );
  console.log(`Visit /dashboard/agents/inbox as a TENANT_ADMIN+MAINTENANCE on this tenant.`);
}

async function main() {
  const args = process.argv.slice(2);
  const wantClean = args.includes("--clean");
  const tenantArg = args.find((a) => !a.startsWith("--"));

  if (wantClean) {
    await clean();
    if (tenantArg) await seedForTenant(tenantArg);
    return;
  }
  await seedForTenant(tenantArg);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
