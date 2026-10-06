import { prisma } from "@/lib/prisma";
import {
  AgentProposalAudience,
  AgentProposalStatus,
  AgentRunStatus,
} from "@prisma/client";
import { BaseAgent, type RunSummary } from "@/lib/agent/base-agent";
import {
  applyProposal,
  registerCommitter,
  rejectProposal,
  hasCommitter,
  _resetCommittersForTest,
} from "@/lib/agent/committers";

// ── Test fixtures ──────────────────────────────────────────────

let tenantId: string;
let approverId: string;
let agentId: string;
let runId: string;

const TEST_KIND = "TEST_PROPOSAL_KIND";

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { name: "Proposal Test Club", slug: "proposal-test-" + Date.now() },
  });
  tenantId = tenant.id;

  const approver = await prisma.user.create({
    data: {
      email: `prop-approver-${Date.now()}@test.com`,
      name: "Approver",
      passwordHash: "x",
      role: "TENANT_ADMIN",
      tenantId,
    },
  });
  approverId = approver.id;

  const systemUser = await prisma.user.create({
    data: {
      email: `prop-agent-${Date.now()}@test.com`,
      name: "Test Agent System User",
      passwordHash: "x",
      role: "USER",
    },
  });
  const agent = await prisma.agentDefinition.create({
    data: {
      slug: "test-proposal-agent-" + Date.now(),
      name: "Test Proposal Agent",
      systemUserId: systemUser.id,
    },
  });
  agentId = agent.id;
});

afterAll(async () => {
  await prisma.agentProposal.deleteMany({ where: { agentId } });
  await prisma.agentRun.deleteMany({ where: { agentId } });
  await prisma.agentDefinition.deleteMany({ where: { id: agentId } });
  await prisma.user.deleteMany({ where: { id: approverId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Fresh run + clean committer registry for each test.
  _resetCommittersForTest();
  const run = await prisma.agentRun.create({
    data: { agentId, tenantId, status: AgentRunStatus.RUNNING },
  });
  runId = run.id;
});

// ── A concrete BaseAgent subclass exposing the protected helpers ───

class TestAgent extends BaseAgent {
  readonly slug = "test-proposal-agent";
  readonly displayName = "Test Proposal Agent";
  protected async process(): Promise<RunSummary> {
    return { itemsProcessed: 0, tasksAffected: 0, decisionsRecorded: 0 };
  }

  // Re-expose protected helpers for the test.
  emit = this.emitProposal.bind(this);
  emitTenant = this.emitTenantProposal.bind(this);
  emitUser = this.emitUserProposal.bind(this);
  emitPlatform = this.emitPlatformProposal.bind(this);
}

const agent = new TestAgent();

// ── emitProposal: shape + audience invariants ───────────────────

describe("BaseAgent.emitProposal", () => {
  test("emits a TENANT-audience proposal with serialised payload", async () => {
    const p = await agent.emitTenant({
      agentId,
      runId,
      tenantId,
      kind: TEST_KIND,
      payload: { foo: "bar", n: 42 },
      confidence: 0.85,
      reasoning: "because reasons",
    });
    expect(p.id).toBeTruthy();
    expect(p.audienceScope).toBe(AgentProposalAudience.TENANT);
    expect(p.tenantId).toBe(tenantId);
    expect(p.userId).toBeNull();
    expect(p.federationId).toBeNull();
    expect(p.kind).toBe(TEST_KIND);
    expect(p.confidence).toBe(0.85);
    expect(p.status).toBe(AgentProposalStatus.PENDING);
    expect(JSON.parse(p.payload)).toEqual({ foo: "bar", n: 42 });
  });

  test("emits a USER-audience proposal with optional targetTenantId", async () => {
    const p = await agent.emitUser({
      agentId,
      runId,
      userId: approverId,
      kind: TEST_KIND,
      payload: { who: "greenkeeper" },
      confidence: 0.5,
      reasoning: "user-scope",
      targetTenantId: tenantId,
    });
    expect(p.audienceScope).toBe(AgentProposalAudience.USER);
    expect(p.userId).toBe(approverId);
    expect(p.tenantId).toBeNull();
    expect(p.targetTenantId).toBe(tenantId);
  });

  test("emits a PLATFORM-audience proposal with no audience id", async () => {
    const p = await agent.emitPlatform({
      agentId,
      runId,
      kind: TEST_KIND,
      payload: { kind: "platform" },
      confidence: 0.9,
      reasoning: "platform",
    });
    expect(p.audienceScope).toBe(AgentProposalAudience.PLATFORM);
    expect(p.tenantId).toBeNull();
    expect(p.userId).toBeNull();
    expect(p.federationId).toBeNull();
  });

  test("rejects TENANT audience with no tenantId", async () => {
    await expect(
      agent.emit({
        agentId,
        runId,
        kind: TEST_KIND,
        payload: {},
        confidence: 0.5,
        reasoning: "missing tenantId",
        audienceScope: AgentProposalAudience.TENANT,
      }),
    ).rejects.toThrow(/TENANT audience requires tenantId/);
  });

  test("rejects USER audience with no userId", async () => {
    await expect(
      agent.emit({
        agentId,
        runId,
        kind: TEST_KIND,
        payload: {},
        confidence: 0.5,
        reasoning: "missing userId",
        audienceScope: AgentProposalAudience.USER,
      }),
    ).rejects.toThrow(/USER audience requires userId/);
  });

  test("rejects FEDERATION audience with no federationId", async () => {
    await expect(
      agent.emit({
        agentId,
        runId,
        kind: TEST_KIND,
        payload: {},
        confidence: 0.5,
        reasoning: "missing federationId",
        audienceScope: AgentProposalAudience.FEDERATION,
      }),
    ).rejects.toThrow(/FEDERATION audience requires federationId/);
  });
});

// ── Committer registry ────────────────────────────────────────────

describe("committer registry", () => {
  test("registerCommitter stores by kind", () => {
    expect(hasCommitter(TEST_KIND)).toBe(false);
    registerCommitter(TEST_KIND, async () => ({
      entityType: "TestEntity",
      entityId: "test-id",
    }));
    expect(hasCommitter(TEST_KIND)).toBe(true);
  });

  test("registerCommitter rejects duplicate registration", () => {
    registerCommitter(TEST_KIND, async () => ({
      entityType: "X",
      entityId: "1",
    }));
    expect(() =>
      registerCommitter(TEST_KIND, async () => ({
        entityType: "Y",
        entityId: "2",
      })),
    ).toThrow(/already registered/);
  });
});

// ── applyProposal: approve flow ───────────────────────────────────

describe("applyProposal", () => {
  test("runs committer, marks proposal APPROVED with entity ref", async () => {
    let received: unknown = null;
    registerCommitter(TEST_KIND, async ({ payload }) => {
      received = payload;
      return { entityType: "TestThing", entityId: "thing-123" };
    });

    const p = await agent.emitTenant({
      agentId,
      runId,
      tenantId,
      kind: TEST_KIND,
      payload: { hello: "world" },
      confidence: 0.7,
      reasoning: "for test",
    });

    const committed = await applyProposal({
      proposalId: p.id,
      approverId,
    });

    expect(received).toEqual({ hello: "world" });
    expect(committed.status).toBe(AgentProposalStatus.APPROVED);
    expect(committed.committedAt).not.toBeNull();
    expect(committed.committedById).toBe(approverId);
    expect(committed.committedEntityType).toBe("TestThing");
    expect(committed.committedEntityId).toBe("thing-123");
    expect(committed.committedPayloadDiff).toBeNull();
  });

  test("captures edit deltas on approve-with-edits", async () => {
    let receivedEdits: unknown = null;
    registerCommitter(TEST_KIND, async ({ payload, edits }) => {
      receivedEdits = edits;
      return { entityType: "Edited", entityId: "e-1" };
    });

    const p = await agent.emitTenant({
      agentId,
      runId,
      tenantId,
      kind: TEST_KIND,
      payload: { title: "draft", priority: "LOW" },
      confidence: 0.6,
      reasoning: "edits test",
    });

    const committed = await applyProposal({
      proposalId: p.id,
      approverId,
      edits: { priority: "HIGH" },
    });

    expect(receivedEdits).toEqual({ priority: "HIGH" });
    expect(committed.committedPayloadDiff).toBe(JSON.stringify({ priority: "HIGH" }));
  });

  test("throws if no committer registered for kind", async () => {
    const p = await agent.emitTenant({
      agentId,
      runId,
      tenantId,
      kind: "UNREGISTERED_KIND",
      payload: {},
      confidence: 0.5,
      reasoning: "no committer",
    });
    await expect(applyProposal({ proposalId: p.id, approverId })).rejects.toThrow(
      /No committer registered/,
    );
  });

  test("refuses to commit a non-PENDING proposal", async () => {
    registerCommitter(TEST_KIND, async () => ({
      entityType: "X",
      entityId: "1",
    }));
    const p = await agent.emitTenant({
      agentId,
      runId,
      tenantId,
      kind: TEST_KIND,
      payload: {},
      confidence: 0.5,
      reasoning: "double-commit",
    });
    await applyProposal({ proposalId: p.id, approverId });
    await expect(applyProposal({ proposalId: p.id, approverId })).rejects.toThrow(
      /can only commit PENDING/,
    );
  });
});

// ── rejectProposal ────────────────────────────────────────────────

describe("rejectProposal", () => {
  test("marks proposal REJECTED with reason", async () => {
    const p = await agent.emitTenant({
      agentId,
      runId,
      tenantId,
      kind: TEST_KIND,
      payload: {},
      confidence: 0.4,
      reasoning: "to be rejected",
    });
    const rejected = await rejectProposal({
      proposalId: p.id,
      rejecterId: approverId,
      reason: "not appropriate this time",
    });
    expect(rejected.status).toBe(AgentProposalStatus.REJECTED);
    expect(rejected.rejectReason).toBe("not appropriate this time");
    expect(rejected.rejectedById).toBe(approverId);
    expect(rejected.rejectedAt).not.toBeNull();
  });

  test("refuses to reject a non-PENDING proposal", async () => {
    registerCommitter(TEST_KIND, async () => ({
      entityType: "X",
      entityId: "1",
    }));
    const p = await agent.emitTenant({
      agentId,
      runId,
      tenantId,
      kind: TEST_KIND,
      payload: {},
      confidence: 0.5,
      reasoning: "approve then try to reject",
    });
    await applyProposal({ proposalId: p.id, approverId });
    await expect(
      rejectProposal({ proposalId: p.id, rejecterId: approverId }),
    ).rejects.toThrow(/can only reject PENDING/);
  });

  test("reason is optional (null reject)", async () => {
    const p = await agent.emitTenant({
      agentId,
      runId,
      tenantId,
      kind: TEST_KIND,
      payload: {},
      confidence: 0.4,
      reasoning: "no-reason reject",
    });
    const rejected = await rejectProposal({
      proposalId: p.id,
      rejecterId: approverId,
    });
    expect(rejected.status).toBe(AgentProposalStatus.REJECTED);
    expect(rejected.rejectReason).toBeNull();
  });
});
