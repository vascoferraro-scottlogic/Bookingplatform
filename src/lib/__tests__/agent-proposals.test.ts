jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
// No real LLM: BaseAgent resolves its provider at construction time.
jest.mock("@/lib/agent/providers", () => ({ getProvider: () => ({ name: "stub", call: jest.fn() }) }));

import {
  AgentProposalAudience,
  AgentProposalStatus,
} from "@prisma/client";
import { prismaMock } from "@/test-utils/prisma-mock";
import { BaseAgent, type RunSummary } from "@/lib/agent/base-agent";
import {
  applyProposal,
  registerCommitter,
  rejectProposal,
  hasCommitter,
  _resetCommittersForTest,
} from "@/lib/agent/committers";

// ── Test fixtures ──────────────────────────────────────────────

const tenantId = "tenant-1";
const approverId = "approver-1";
const agentId = "agent-1";
const runId = "run-1";

const TEST_KIND = "TEST_PROPOSAL_KIND";

/**
 * In-memory agentProposal table: create stores a row (with schema defaults),
 * findUnique reads it back, update merges into it. Lets one test emit,
 * approve and re-approve the same proposal.
 */
function useProposalStore() {
  const rows = new Map<string, Record<string, unknown>>();
  let seq = 0;
  prismaMock.agentProposal.create.mockImplementation((async ({ data }: any) => {
    const row = {
      id: `p${++seq}`,
      status: AgentProposalStatus.PENDING,
      committedAt: null,
      committedById: null,
      committedEntityType: null,
      committedEntityId: null,
      committedPayloadDiff: null,
      rejectedAt: null,
      rejectedById: null,
      rejectReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    };
    rows.set(row.id, row);
    return row;
  }) as never);
  prismaMock.agentProposal.findUnique.mockImplementation((async ({ where }: any) => rows.get(where.id) ?? null) as never);
  prismaMock.agentProposal.update.mockImplementation((async ({ where, data }: any) => {
    const row = { ...rows.get(where.id)!, ...data };
    rows.set(where.id, row);
    return row;
  }) as never);
}

beforeEach(() => {
  // Clean committer registry for each test.
  _resetCommittersForTest();
  useProposalStore();
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
    expect(prismaMock.agentProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ agentId, runId, reasoning: "because reasons", targetTenantId: null, expiresAt: null }),
    });
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
    expect(prismaMock.agentProposal.create).not.toHaveBeenCalled();
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
    expect(prismaMock.agentProposal.create).not.toHaveBeenCalled();
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
    expect(prismaMock.agentProposal.create).not.toHaveBeenCalled();
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
    expect(prismaMock.agentProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: p.id } }),
    );
  });

  test("captures edit deltas on approve-with-edits", async () => {
    let receivedEdits: unknown = null;
    registerCommitter(TEST_KIND, async ({ edits }) => {
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
    expect(prismaMock.agentProposal.update).not.toHaveBeenCalled();
  });

  test("refuses to commit a non-PENDING proposal", async () => {
    const committer = jest.fn(async () => ({ entityType: "X", entityId: "1" }));
    registerCommitter(TEST_KIND, committer);
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
    expect(committer).toHaveBeenCalledTimes(1);
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
    expect(prismaMock.agentProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: p.id } }),
    );
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

  test("throws when the proposal does not exist", async () => {
    await expect(rejectProposal({ proposalId: "missing", rejecterId: approverId })).rejects.toThrow(/not found/);
  });
});
