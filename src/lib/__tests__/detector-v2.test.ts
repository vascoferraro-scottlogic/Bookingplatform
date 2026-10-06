/**
 * Tests for the v2 DetectionAgent (step 3c-ii migration).
 *
 * Verifies the agent has stopped writing tasks directly and now emits
 * MAINTENANCE_TASK_CREATE proposals. Behavioural contract (decisions log
 * 2026-05-03 — agent v2 propose-not-publish):
 *
 *  - Eligible complaints (above sensitivity threshold) become AgentProposal
 *    rows with kind=MAINTENANCE_TASK_CREATE.
 *  - Proposal payload carries title/description/category/priority +
 *    sourceMessageIds=[messageId] + participantCount=1 (1:1 mode).
 *  - AgentDecision rows reference the proposalId and carry sourceMessageId
 *    (the only place per-message provenance lives).
 *  - No MaintenanceTask rows created during the run.
 *  - maxTasksPerRun caps proposals; over-cap complaints get a NO_ACTION
 *    decision so we keep the learning signal.
 *  - Cursor advances even when no proposals emitted.
 */

import { prisma } from "@/lib/prisma";
import {
  AgentAction,
  AgentProposalStatus,
  ChannelType,
} from "@prisma/client";
import { DetectionAgent } from "@/lib/agent/agents/detector";
import { MAINTENANCE_TASK_CREATE_KIND } from "@/lib/agent/committers/maintenance-task-create";
import "@/lib/agent/committers/register-all";

let tenantId: string;
let agentSystemUserId: string;
let memberId: string;
let channelId: string;
let agentId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { name: "Detector Test Club", slug: "det-test-" + Date.now() },
  });
  tenantId = tenant.id;

  // Use the existing seeded "detector" AgentDefinition rather than creating
  // one — its systemUser is shared with other tests / dev data, and replacing
  // the systemUserId via upsert would orphan FK references at teardown.
  const def = await prisma.agentDefinition.findUnique({ where: { slug: "detector" } });
  if (!def) {
    throw new Error(
      `Seeded AgentDefinition for slug "detector" missing — run \`npx prisma db seed\``,
    );
  }
  agentId = def.id;
  agentSystemUserId = def.systemUserId;

  const member = await prisma.user.create({
    data: {
      email: `det-mem-${Date.now()}@test.com`,
      name: "Member",
      passwordHash: "x",
      role: "USER",
      tenantId,
    },
  });
  memberId = member.id;

  const channel = await prisma.channel.create({
    data: {
      tenantId,
      name: "general-" + Date.now(),
      type: ChannelType.PUBLIC,
      createdById: memberId,
    },
  });
  channelId = channel.id;
});

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 200));
  // Only tear down what this test created. Leave the seeded detector
  // AgentDefinition + its systemUser alone (shared with the dev/seed setup).
  await prisma.taskNote.deleteMany({ where: { task: { tenantId } } });
  await prisma.maintenanceTask.deleteMany({ where: { tenantId } });
  await prisma.agentDecision.deleteMany({ where: { tenantId } });
  await prisma.agentProposal.deleteMany({ where: { tenantId } });
  await prisma.agentRun.deleteMany({ where: { tenantId } });
  await prisma.agentMemory.deleteMany({ where: { tenantId } });
  await prisma.agentConfig.deleteMany({ where: { tenantId } });
  await prisma.message.deleteMany({ where: { tenantId } });
  await prisma.channel.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { id: memberId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Wipe per-tenant agent state but keep fixtures.
  await prisma.taskNote.deleteMany({ where: { task: { tenantId } } });
  await prisma.maintenanceTask.deleteMany({ where: { tenantId } });
  await prisma.agentDecision.deleteMany({ where: { tenantId } });
  await prisma.agentProposal.deleteMany({ where: { tenantId } });
  await prisma.agentRun.deleteMany({ where: { tenantId } });
  await prisma.agentMemory.deleteMany({ where: { tenantId } });
  await prisma.message.deleteMany({ where: { tenantId } });
});

async function seedMessages(bodies: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const body of bodies) {
    const m = await prisma.message.create({
      data: { tenantId, channelId, userId: memberId, body },
    });
    ids.push(m.id);
  }
  return ids;
}

/** Build a fake provider that returns a fixed classification for given message ids. */
function makeFakeProvider(classifications: Array<{
  messageId: string;
  isComplaint: boolean;
  category?: string;
  priority?: string;
  suggestedTitle?: string;
  suggestedDescription?: string;
  confidence?: number;
  reasoning?: string;
}>) {
  return {
    name: "fake",
    async call() {
      return {
        content: { complaints: classifications },
        model: "fake",
        usage: {},
      };
    },
  };
}

describe("DetectionAgent v2 — propose-not-publish", () => {
  test("emits one MAINTENANCE_TASK_CREATE proposal per eligible complaint and creates NO MaintenanceTask", async () => {
    const [m1, m2, m3] = await seedMessages([
      "Rink 2 is really uneven near the head, hard to bowl",
      "Anyone fancy a coffee?",
      "Sprinkler is stuck on green 3 and has been all morning",
    ]);

    const agent = new DetectionAgent();
    (agent as unknown as { provider: unknown }).provider = makeFakeProvider([
      { messageId: m1, isComplaint: true, category: "RINK_SURFACE", priority: "MEDIUM",
        suggestedTitle: "Rink 2 surface uneven", suggestedDescription: "Members report bumps",
        confidence: 0.8, reasoning: "Clear complaint" },
      { messageId: m2, isComplaint: false, confidence: 0.9 },
      { messageId: m3, isComplaint: true, category: "GROUNDS", priority: "HIGH",
        suggestedTitle: "Sprinkler stuck on green 3", suggestedDescription: "Stuck running",
        confidence: 0.9, reasoning: "Equipment issue" },
    ]);

    const run = await agent.runForTenant(tenantId);
    expect(run.status).toBe("COMPLETED");

    // No tasks created directly
    const tasks = await prisma.maintenanceTask.findMany({ where: { tenantId } });
    expect(tasks).toHaveLength(0);

    // Two proposals emitted, one per eligible complaint
    const proposals = await prisma.agentProposal.findMany({
      where: { tenantId, kind: MAINTENANCE_TASK_CREATE_KIND },
      orderBy: { createdAt: "asc" },
    });
    expect(proposals).toHaveLength(2);
    expect(proposals.every((p) => p.status === AgentProposalStatus.PENDING)).toBe(true);

    const payloads = proposals.map((p) => JSON.parse(p.payload));
    expect(payloads[0]).toMatchObject({
      title: "Rink 2 surface uneven",
      category: "RINK_SURFACE",
      priority: "MEDIUM",
      participantCount: 1,
      sourceMessageIds: [m1],
    });
    expect(payloads[1]).toMatchObject({
      title: "Sprinkler stuck on green 3",
      category: "GROUNDS",
      participantCount: 1,
      sourceMessageIds: [m3],
    });

    // Decisions reference the proposals + carry sourceMessageId
    const decisions = await prisma.agentDecision.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });
    expect(decisions).toHaveLength(2);
    expect(decisions[0].proposalId).toBe(proposals[0].id);
    expect(decisions[0].sourceMessageId).toBe(m1);
    expect(decisions[1].proposalId).toBe(proposals[1].id);
    expect(decisions[1].sourceMessageId).toBe(m3);
  });

  test("filters out below-threshold complaints", async () => {
    const [m1] = await seedMessages([
      "Maybe the rink is a bit slow today, not sure",
    ]);

    const agent = new DetectionAgent();
    (agent as unknown as { provider: unknown }).provider = makeFakeProvider([
      { messageId: m1, isComplaint: true, category: "RINK_SURFACE", priority: "LOW",
        confidence: 0.3 }, // below default 0.6 threshold
    ]);

    await agent.runForTenant(tenantId);
    const proposals = await prisma.agentProposal.findMany({ where: { tenantId } });
    expect(proposals).toHaveLength(0);
  });

  test("respects maxTasksPerRun cap; over-cap complaints get NO_ACTION decision", async () => {
    const ids = await seedMessages([
      "Issue A on rink 1",
      "Issue B in clubhouse",
      "Issue C in pavilion",
      "Issue D with sprinklers",
      "Issue E in toilets",
      "Issue F in changing rooms",
      "Issue G with lighting",
    ]);

    // Lower the cap via AgentConfig
    await prisma.agentConfig.upsert({
      where: { agentId_tenantId: { agentId, tenantId } },
      create: {
        agentId, tenantId,
        config: JSON.stringify({ maxTasksPerRun: 3, sensitivityThreshold: 0.5 }),
        enabled: true,
      },
      update: {
        config: JSON.stringify({ maxTasksPerRun: 3, sensitivityThreshold: 0.5 }),
        enabled: true,
      },
    });

    const agent = new DetectionAgent();
    (agent as unknown as { provider: unknown }).provider = makeFakeProvider(
      ids.map((id, i) => ({
        messageId: id,
        isComplaint: true,
        category: "GENERAL",
        priority: "MEDIUM",
        suggestedTitle: `Issue ${i}`,
        suggestedDescription: `desc ${i}`,
        confidence: 0.8,
      })),
    );

    await agent.runForTenant(tenantId);

    const proposals = await prisma.agentProposal.findMany({ where: { tenantId } });
    expect(proposals).toHaveLength(3); // capped

    const noActionDecisions = await prisma.agentDecision.findMany({
      where: { tenantId, action: AgentAction.NO_ACTION, proposalId: null },
    });
    expect(noActionDecisions.length).toBe(ids.length - 3); // remainder logged

    // cleanup config so next test gets defaults
    await prisma.agentConfig.deleteMany({ where: { agentId, tenantId } });
  });

  test("advances cursor even when no complaints flagged", async () => {
    const [m1] = await seedMessages(["Hello world chitchat"]);

    const agent = new DetectionAgent();
    (agent as unknown as { provider: unknown }).provider = makeFakeProvider([
      { messageId: m1, isComplaint: false, confidence: 0.95 },
    ]);

    await agent.runForTenant(tenantId);

    const memory = await prisma.agentMemory.findUnique({
      where: { agentId_tenantId_key: { agentId, tenantId, key: "last_processed_at" } },
    });
    expect(memory).not.toBeNull();
  });
});

describe("DetectionAgent v2 — clustering (3c-iii)", () => {
  let memberB: string;
  let memberC: string;

  beforeAll(async () => {
    const b = await prisma.user.create({
      data: { email: `det-memB-${Date.now()}@test.com`, name: "MemB", passwordHash: "x", role: "USER", tenantId },
    });
    memberB = b.id;
    const c = await prisma.user.create({
      data: { email: `det-memC-${Date.now()}@test.com`, name: "MemC", passwordHash: "x", role: "USER", tenantId },
    });
    memberC = c.id;
  });

  afterAll(async () => {
    // Inner block teardown runs BEFORE outer afterAll. Delete cluster
    // messages first so the user delete doesn't trip the FK.
    await prisma.agentDecision.deleteMany({ where: { tenantId } });
    await prisma.agentProposal.deleteMany({ where: { tenantId } });
    await prisma.message.deleteMany({ where: { tenantId, userId: { in: [memberB, memberC] } } });
    await prisma.user.deleteMany({ where: { id: { in: [memberB, memberC] } } });
  });

  async function seedFromUser(userId: string, body: string): Promise<string> {
    const m = await prisma.message.create({
      data: { tenantId, channelId, userId, body },
    });
    return m.id;
  }

  test("merges similar messages from multiple authors into ONE proposal with participantCount=N", async () => {
    const m1 = await seedFromUser(memberId, "Rink 3 surface uneven near south end");
    const m2 = await seedFromUser(memberB, "Rink 3 surface uneven and bumpy");
    const m3 = await seedFromUser(memberC, "Yeah rink 3 surface really uneven today");

    const agent = new DetectionAgent();
    (agent as unknown as { provider: unknown }).provider = makeFakeProvider([
      { messageId: m1, isComplaint: true, category: "RINK_SURFACE", priority: "MEDIUM",
        suggestedTitle: "Rink 3 surface uneven", suggestedDescription: "Multiple reports",
        confidence: 0.7, toneSeverity: 0.5, toneLabel: "concerned" },
      { messageId: m2, isComplaint: true, category: "RINK_SURFACE", priority: "MEDIUM",
        suggestedTitle: "Rink 3 uneven", suggestedDescription: "x",
        confidence: 0.85, toneSeverity: 0.7, toneLabel: "frustrated" }, // highest confidence → canonical
      { messageId: m3, isComplaint: true, category: "RINK_SURFACE", priority: "MEDIUM",
        suggestedTitle: "Rink 3 uneven again", suggestedDescription: "x",
        confidence: 0.75, toneSeverity: 0.4 },
    ]);

    await agent.runForTenant(tenantId);

    const proposals = await prisma.agentProposal.findMany({
      where: { tenantId, kind: MAINTENANCE_TASK_CREATE_KIND },
    });
    expect(proposals).toHaveLength(1);

    const payload = JSON.parse(proposals[0].payload);
    expect(payload.title).toBe("Rink 3 uneven"); // canonical = highest confidence
    expect(payload.participantCount).toBe(3);
    expect(payload.sourceMessageIds).toEqual(expect.arrayContaining([m1, m2, m3]));
    expect(payload.toneSeverity).toBe(0.7); // max across cluster
    expect(payload.toneLabel).toBe("frustrated"); // label of max-severity voice

    // 3 decisions, all referencing the same proposal
    const decisions = await prisma.agentDecision.findMany({
      where: { tenantId, proposalId: proposals[0].id },
    });
    expect(decisions).toHaveLength(3);
  });

  test("unrelated complaints do NOT cluster — one proposal each", async () => {
    const m1 = await seedFromUser(memberId, "Sprinkler on green 1 stuck running");
    const m2 = await seedFromUser(memberB, "Net torn on rink 4");

    const agent = new DetectionAgent();
    (agent as unknown as { provider: unknown }).provider = makeFakeProvider([
      { messageId: m1, isComplaint: true, category: "GROUNDS", priority: "MEDIUM",
        suggestedTitle: "Sprinkler stuck", suggestedDescription: "x", confidence: 0.8 },
      { messageId: m2, isComplaint: true, category: "EQUIPMENT", priority: "MEDIUM",
        suggestedTitle: "Net torn rink 4", suggestedDescription: "x", confidence: 0.8 },
    ]);

    await agent.runForTenant(tenantId);
    const proposals = await prisma.agentProposal.findMany({
      where: { tenantId, kind: MAINTENANCE_TASK_CREATE_KIND },
    });
    expect(proposals).toHaveLength(2);
  });

  test("cluster with mix of complaint + non-complaint emits proposal covering all cluster members", async () => {
    const m1 = await seedFromUser(memberId, "Heating broken clubhouse lounge");
    const m2 = await seedFromUser(memberB, "Heating broken clubhouse lounge yes");
    // m3 has strong topical overlap → SAME cluster — but LLM disagrees on
    // whether it's a complaint. Cluster membership is topical, not
    // classification-based; participantCount counts all cluster authors.
    const m3 = await seedFromUser(memberC, "Heating broken clubhouse lounge actually fine now");

    const agent = new DetectionAgent();
    (agent as unknown as { provider: unknown }).provider = makeFakeProvider([
      { messageId: m1, isComplaint: true, category: "FACILITIES", priority: "MEDIUM",
        suggestedTitle: "Heating broken clubhouse", suggestedDescription: "x", confidence: 0.85 },
      { messageId: m2, isComplaint: true, category: "FACILITIES", priority: "MEDIUM",
        suggestedTitle: "Heating broken", suggestedDescription: "x", confidence: 0.75 },
      { messageId: m3, isComplaint: false, confidence: 0.9 },
    ]);

    await agent.runForTenant(tenantId);
    const proposals = await prisma.agentProposal.findMany({
      where: { tenantId, kind: MAINTENANCE_TASK_CREATE_KIND },
    });
    expect(proposals).toHaveLength(1);
    const payload = JSON.parse(proposals[0].payload);
    // participantCount counts distinct authors of cluster members
    expect(payload.participantCount).toBe(3);
    expect(payload.sourceMessageIds).toHaveLength(3);
    // Only the 2 complaint members get decision rows linked to this proposal
    const decisions = await prisma.agentDecision.findMany({
      where: { tenantId, proposalId: proposals[0].id },
    });
    expect(decisions).toHaveLength(2);
  });
});
