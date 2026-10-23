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
jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
// No real LLM: each test swaps in a fake provider after construction.
jest.mock("@/lib/agent/providers", () => ({ getProvider: () => ({ name: "stub", call: jest.fn() }) }));

import {
  AgentAction,
  AgentProposalStatus,
  ChannelType,
} from "@prisma/client";
import { prismaMock } from "@/test-utils/prisma-mock";
import { DetectionAgent } from "@/lib/agent/agents/detector";
import { MAINTENANCE_TASK_CREATE_KIND } from "@/lib/agent/committers/maintenance-task-create";
import "@/lib/agent/committers/register-all";

const tenantId = "tenant-1";
const channelId = "channel-1";
const memberId = "member-1";
const memberB = "member-2";
const memberC = "member-3";
// Stands in for the seeded "detector" AgentDefinition.
const DETECTOR = { id: "agent-detector", slug: "detector", name: "Detection Agent", systemUserId: "sys-detector" };

let messageSeq = 0;
let messages: Array<Record<string, unknown>> = [];

/** Queue messages for message.findMany, oldest first, a minute apart. */
function seedMessages(bodies: string[], userId = memberId): string[] {
  return bodies.map((body) => seedFromUser(userId, body));
}

function seedFromUser(userId: string, body: string): string {
  const id = `msg-${++messageSeq}`;
  messages.push({
    id,
    tenantId,
    channelId,
    userId,
    body,
    pinned: false,
    deletedAt: null,
    createdAt: new Date(Date.now() - (30 - messages.length) * 60_000),
    updatedAt: new Date(),
    user: { name: userId, email: `${userId}@example.test` },
    channel: { name: "general", type: ChannelType.PUBLIC },
  });
  return id;
}

beforeEach(() => {
  messages = [];
  let proposalSeq = 0;
  let decisionSeq = 0;
  prismaMock.agentDefinition.findUnique.mockResolvedValue(DETECTOR as never);
  prismaMock.agentRun.create.mockImplementation((async ({ data }: any) => ({ id: "run-1", ...data })) as never);
  prismaMock.agentRun.update.mockImplementation((async ({ where, data }: any) => ({ id: where.id, ...data })) as never);
  prismaMock.agentConfig.findUnique.mockResolvedValue(null);
  prismaMock.agentMemory.findUnique.mockResolvedValue(null);
  prismaMock.message.findMany.mockImplementation((async () => messages) as never);
  prismaMock.tenant.findUnique.mockResolvedValue({ name: "Detector Test Club", latitude: null, longitude: null } as never);
  prismaMock.agentKnowledge.findMany.mockResolvedValue([]);
  prismaMock.agentProposal.create.mockImplementation((async ({ data }: any) => ({
    id: `proposal-${++proposalSeq}`,
    status: AgentProposalStatus.PENDING,
    ...data,
  })) as never);
  prismaMock.agentDecision.create.mockImplementation((async ({ data }: any) => ({ id: `decision-${++decisionSeq}`, ...data })) as never);
});

const proposals = () => prismaMock.agentProposal.create.mock.calls.map((c) => (c[0] as any).data);
const decisions = () => prismaMock.agentDecision.create.mock.calls.map((c) => (c[0] as any).data);
const proposalIds = () =>
  Promise.all(prismaMock.agentProposal.create.mock.results.map((r) => r.value)).then((rows) => rows.map((p: any) => p.id));

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
  toneSeverity?: number;
  toneLabel?: string;
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

function agentWith(provider: ReturnType<typeof makeFakeProvider>) {
  const agent = new DetectionAgent();
  (agent as unknown as { provider: unknown }).provider = provider;
  return agent;
}

describe("DetectionAgent v2 — propose-not-publish", () => {
  test("emits one MAINTENANCE_TASK_CREATE proposal per eligible complaint and creates NO MaintenanceTask", async () => {
    const [m1, m2, m3] = seedMessages([
      "Rink 2 is really uneven near the head, hard to bowl",
      "Anyone fancy a coffee?",
      "Sprinkler is stuck on green 3 and has been all morning",
    ]);

    const agent = agentWith(makeFakeProvider([
      { messageId: m1, isComplaint: true, category: "RINK_SURFACE", priority: "MEDIUM",
        suggestedTitle: "Rink 2 surface uneven", suggestedDescription: "Members report bumps",
        confidence: 0.8, reasoning: "Clear complaint" },
      { messageId: m2, isComplaint: false, confidence: 0.9 },
      { messageId: m3, isComplaint: true, category: "GROUNDS", priority: "HIGH",
        suggestedTitle: "Sprinkler stuck on green 3", suggestedDescription: "Stuck running",
        confidence: 0.9, reasoning: "Equipment issue" },
    ]));

    const run = await agent.runForTenant(tenantId);
    expect(run.status).toBe("COMPLETED");

    // Messages are read for this tenant only, excluding the agent's own posts.
    expect(prismaMock.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId, userId: { not: DETECTOR.systemUserId } }),
      }),
    );

    // No tasks created directly
    expect(prismaMock.maintenanceTask.create).not.toHaveBeenCalled();
    expect(prismaMock.maintenanceTask.update).not.toHaveBeenCalled();

    // Two proposals emitted, one per eligible complaint
    const emitted = proposals();
    expect(emitted).toHaveLength(2);
    expect(emitted.every((p) => p.kind === MAINTENANCE_TASK_CREATE_KIND && p.tenantId === tenantId)).toBe(true);
    // emitProposal does not set status, so the schema default (PENDING) applies.
    expect(emitted.every((p) => !("status" in p))).toBe(true);

    const payloads = emitted.map((p) => JSON.parse(p.payload));
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
    const ids = await proposalIds();
    const recorded = decisions();
    expect(recorded).toHaveLength(2);
    expect(recorded[0].proposalId).toBe(ids[0]);
    expect(recorded[0].sourceMessageId).toBe(m1);
    expect(recorded[0].tenantId).toBe(tenantId);
    expect(recorded[1].proposalId).toBe(ids[1]);
    expect(recorded[1].sourceMessageId).toBe(m3);
  });

  test("filters out below-threshold complaints", async () => {
    const [m1] = seedMessages([
      "Maybe the rink is a bit slow today, not sure",
    ]);

    const agent = agentWith(makeFakeProvider([
      { messageId: m1, isComplaint: true, category: "RINK_SURFACE", priority: "LOW",
        confidence: 0.3 }, // below default 0.6 threshold
    ]));

    await agent.runForTenant(tenantId);
    expect(prismaMock.agentProposal.create).not.toHaveBeenCalled();
  });

  test("respects maxTasksPerRun cap; over-cap complaints get NO_ACTION decision", async () => {
    const ids = seedMessages([
      "Issue A on rink 1",
      "Issue B in clubhouse",
      "Issue C in pavilion",
      "Issue D with sprinklers",
      "Issue E in toilets",
      "Issue F in changing rooms",
      "Issue G with lighting",
    ]);

    // Lower the cap via AgentConfig
    prismaMock.agentConfig.findUnique.mockResolvedValue({
      agentId: DETECTOR.id,
      tenantId,
      config: JSON.stringify({ maxTasksPerRun: 3, sensitivityThreshold: 0.5 }),
      enabled: true,
    } as never);

    const agent = agentWith(makeFakeProvider(
      ids.map((id, i) => ({
        messageId: id,
        isComplaint: true,
        category: "FACILITIES", // a qualifying (D-14) category, so only the cap limits proposals
        priority: "MEDIUM",
        suggestedTitle: `Issue ${i}`,
        suggestedDescription: `desc ${i}`,
        confidence: 0.8,
      })),
    ));

    await agent.runForTenant(tenantId);

    expect(prismaMock.agentConfig.findUnique).toHaveBeenCalledWith({
      where: { agentId_tenantId: { agentId: DETECTOR.id, tenantId } },
    });
    expect(proposals()).toHaveLength(3); // capped

    const noActionDecisions = decisions().filter(
      (d) => d.action === AgentAction.NO_ACTION && d.proposalId === undefined,
    );
    expect(noActionDecisions.length).toBe(ids.length - 3); // remainder logged
  });

  test("advances cursor even when no complaints flagged", async () => {
    const [m1] = seedMessages(["Hello world chitchat"]);

    const agent = agentWith(makeFakeProvider([
      { messageId: m1, isComplaint: false, confidence: 0.95 },
    ]));

    await agent.runForTenant(tenantId);

    expect(prismaMock.agentProposal.create).not.toHaveBeenCalled();
    expect(prismaMock.agentMemory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { agentId_tenantId_key: { agentId: DETECTOR.id, tenantId, key: "last_processed_at" } },
        create: expect.objectContaining({
          value: JSON.stringify({ lastProcessedAt: (messages[0].createdAt as Date).toISOString() }),
        }),
      }),
    );
  });
});

describe("DetectionAgent v2 — clustering (3c-iii)", () => {
  test("merges similar messages from multiple authors into ONE proposal with participantCount=N", async () => {
    const m1 = seedFromUser(memberId, "Rink 3 surface uneven near south end");
    const m2 = seedFromUser(memberB, "Rink 3 surface uneven and bumpy");
    const m3 = seedFromUser(memberC, "Yeah rink 3 surface really uneven today");

    const agent = agentWith(makeFakeProvider([
      { messageId: m1, isComplaint: true, category: "RINK_SURFACE", priority: "MEDIUM",
        suggestedTitle: "Rink 3 surface uneven", suggestedDescription: "Multiple reports",
        confidence: 0.7, toneSeverity: 0.5, toneLabel: "concerned" },
      { messageId: m2, isComplaint: true, category: "RINK_SURFACE", priority: "MEDIUM",
        suggestedTitle: "Rink 3 uneven", suggestedDescription: "x",
        confidence: 0.85, toneSeverity: 0.7, toneLabel: "frustrated" }, // highest confidence → canonical
      { messageId: m3, isComplaint: true, category: "RINK_SURFACE", priority: "MEDIUM",
        suggestedTitle: "Rink 3 uneven again", suggestedDescription: "x",
        confidence: 0.75, toneSeverity: 0.4 },
    ]));

    await agent.runForTenant(tenantId);

    const emitted = proposals();
    expect(emitted).toHaveLength(1);

    const payload = JSON.parse(emitted[0].payload);
    expect(payload.title).toBe("Rink 3 uneven"); // canonical = highest confidence
    expect(payload.participantCount).toBe(3);
    expect(payload.sourceMessageIds).toEqual(expect.arrayContaining([m1, m2, m3]));
    expect(payload.toneSeverity).toBe(0.7); // max across cluster
    expect(payload.toneLabel).toBe("frustrated"); // label of max-severity voice

    // 3 decisions, all referencing the same proposal
    const [proposalId] = await proposalIds();
    expect(decisions().filter((d) => d.proposalId === proposalId)).toHaveLength(3);
  });

  test("unrelated complaints do NOT cluster — one proposal each", async () => {
    const m1 = seedFromUser(memberId, "Sprinkler on green 1 stuck running");
    const m2 = seedFromUser(memberB, "Loose paving slab by the clubhouse steps");

    const agent = agentWith(makeFakeProvider([
      { messageId: m1, isComplaint: true, category: "GROUNDS", priority: "MEDIUM",
        suggestedTitle: "Sprinkler stuck", suggestedDescription: "x", confidence: 0.8 },
      { messageId: m2, isComplaint: true, category: "SAFETY", priority: "HIGH",
        suggestedTitle: "Loose paving slab", suggestedDescription: "x", confidence: 0.8 },
    ]));

    await agent.runForTenant(tenantId);
    expect(proposals()).toHaveLength(2);
  });

  test("cluster with mix of complaint + non-complaint emits proposal covering all cluster members", async () => {
    seedFromUser(memberId, "Heating broken clubhouse lounge");
    seedFromUser(memberB, "Heating broken clubhouse lounge yes");
    // m3 has strong topical overlap → SAME cluster — but LLM disagrees on
    // whether it's a complaint. Cluster membership is topical, not
    // classification-based; participantCount counts all cluster authors.
    seedFromUser(memberC, "Heating broken clubhouse lounge actually fine now");
    const [m1, m2, m3] = messages.map((m) => m.id as string);

    const agent = agentWith(makeFakeProvider([
      { messageId: m1, isComplaint: true, category: "FACILITIES", priority: "MEDIUM",
        suggestedTitle: "Heating broken clubhouse", suggestedDescription: "x", confidence: 0.85 },
      { messageId: m2, isComplaint: true, category: "FACILITIES", priority: "MEDIUM",
        suggestedTitle: "Heating broken", suggestedDescription: "x", confidence: 0.75 },
      { messageId: m3, isComplaint: false, confidence: 0.9 },
    ]));

    await agent.runForTenant(tenantId);
    const emitted = proposals();
    expect(emitted).toHaveLength(1);
    const payload = JSON.parse(emitted[0].payload);
    // participantCount counts distinct authors of cluster members
    expect(payload.participantCount).toBe(3);
    expect(payload.sourceMessageIds).toHaveLength(3);
    // Only the 2 complaint members get decision rows linked to this proposal
    const [proposalId] = await proposalIds();
    expect(decisions().filter((d) => d.proposalId === proposalId)).toHaveLength(2);
  });
});

describe("DetectionAgent v2 — triage categories (D-14)", () => {
  test("[B-86] D-14 / FR-AGT-001 – GENERAL and EQUIPMENT complaints produce no proposals", async () => {
    const m1 = seedFromUser(memberId, "The tea urn in the kitchen has stopped working");
    const m2 = seedFromUser(memberB, "Membership renewal emails keep arriving twice");

    const agent = agentWith(makeFakeProvider([
      { messageId: m1, isComplaint: true, category: "EQUIPMENT", priority: "MEDIUM",
        suggestedTitle: "Tea urn broken", suggestedDescription: "x", confidence: 0.9 },
      { messageId: m2, isComplaint: true, category: "GENERAL", priority: "LOW",
        suggestedTitle: "Duplicate renewal emails", suggestedDescription: "x", confidence: 0.9 },
    ]));

    const run = await agent.runForTenant(tenantId);

    expect(run.status).toBe("COMPLETED");
    expect(prismaMock.agentProposal.create).not.toHaveBeenCalled();
    expect(prismaMock.maintenanceTask.create).not.toHaveBeenCalled();
  });

  test("[B-86] D-14 / FR-AGT-001 – SAFETY, FACILITIES and GROUNDS complaints each produce a proposal", async () => {
    const m1 = seedFromUser(memberId, "Loose paving slab by the clubhouse steps");
    const m2 = seedFromUser(memberB, "Heating broken in the changing rooms");
    const m3 = seedFromUser(memberC, "Sprinkler on green 1 stuck running");

    const agent = agentWith(makeFakeProvider([
      { messageId: m1, isComplaint: true, category: "SAFETY", priority: "HIGH",
        suggestedTitle: "Loose paving slab", suggestedDescription: "x", confidence: 0.9 },
      { messageId: m2, isComplaint: true, category: "FACILITIES", priority: "MEDIUM",
        suggestedTitle: "Heating broken", suggestedDescription: "x", confidence: 0.9 },
      { messageId: m3, isComplaint: true, category: "GROUNDS", priority: "MEDIUM",
        suggestedTitle: "Sprinkler stuck", suggestedDescription: "x", confidence: 0.9 },
    ]));

    await agent.runForTenant(tenantId);

    const categories = proposals().map((p) => JSON.parse(p.payload).category);
    expect(categories.sort()).toEqual(["FACILITIES", "GROUNDS", "SAFETY"]);
  });

  test("[B-86] D-14 / FR-AGT-001 – in a mixed batch only the qualifying complaint becomes a proposal", async () => {
    const m1 = seedFromUser(memberId, "Broken handrail on the pavilion stairs");
    const m2 = seedFromUser(memberB, "Scoreboard numbers missing for rink 5");

    const agent = agentWith(makeFakeProvider([
      { messageId: m1, isComplaint: true, category: "SAFETY", priority: "HIGH",
        suggestedTitle: "Broken handrail", suggestedDescription: "x", confidence: 0.9 },
      { messageId: m2, isComplaint: true, category: "EQUIPMENT", priority: "LOW",
        suggestedTitle: "Scoreboard numbers missing", suggestedDescription: "x", confidence: 0.9 },
    ]));

    await agent.runForTenant(tenantId);

    const emitted = proposals();
    expect(emitted).toHaveLength(1);
    expect(JSON.parse(emitted[0].payload)).toMatchObject({ category: "SAFETY", sourceMessageIds: [m1] });
  });
});
