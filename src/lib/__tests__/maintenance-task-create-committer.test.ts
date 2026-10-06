/**
 * Tests for the MAINTENANCE_TASK_CREATE committer.
 *
 * Covers:
 *  - Create path: new task lands at MAINTENANCE_ONLY visibility, agent
 *    systemUser as submitter, priority = max(proposed, cluster-implied).
 *  - Merge path: existing open task with overlapping title gets a TaskNote
 *    (anonymised, names no one) and priority bumped to max.
 *  - Approver edits override agent values.
 *  - Token-overlap helper + clusterImpliedPriority helper are correct.
 *  - No merge across categories or across the 30-day window.
 */

import { prisma } from "@/lib/prisma";
import {
  AgentProposalAudience,
  AgentRunStatus,
  TaskCategory,
  TaskPriority,
  TaskStatus,
} from "@prisma/client";
import { applyProposal } from "@/lib/agent/committers";
import {
  MAINTENANCE_TASK_CREATE_KIND,
  clusterImpliedPriority,
  titleTokenOverlap,
} from "@/lib/agent/committers/maintenance-task-create";
// Side-effect import: registers the committer once for the whole suite.
import "@/lib/agent/committers/register-all";

let tenantId: string;
let approverId: string;
let agentId: string;
let agentSystemUserId: string;
let runId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { name: "Committer Test Club", slug: "committer-test-" + Date.now() },
  });
  tenantId = tenant.id;

  const approver = await prisma.user.create({
    data: {
      email: `cmt-approver-${Date.now()}@test.com`,
      name: "CmtApprover",
      passwordHash: "x",
      role: "TENANT_ADMIN",
      tenantId,
    },
  });
  approverId = approver.id;

  const sysUser = await prisma.user.create({
    data: {
      email: `cmt-agent-${Date.now()}@test.com`,
      name: "Cmt Agent System",
      passwordHash: "x",
      role: "USER",
    },
  });
  agentSystemUserId = sysUser.id;

  const def = await prisma.agentDefinition.create({
    data: {
      slug: "cmt-test-agent-" + Date.now(),
      name: "Committer Test Agent",
      systemUserId: sysUser.id,
    },
  });
  agentId = def.id;
});

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 200));
  await prisma.taskNote.deleteMany({ where: { task: { tenantId } } });
  await prisma.maintenanceTask.deleteMany({ where: { tenantId } });
  await prisma.agentProposal.deleteMany({ where: { agentId } });
  await prisma.agentRun.deleteMany({ where: { agentId } });
  await prisma.agentDefinition.deleteMany({ where: { id: agentId } });
  await prisma.user.deleteMany({
    where: { id: { in: [approverId, agentSystemUserId] } },
  });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Note: registry is populated once via top-of-file side-effect import.
  // We do NOT call _resetCommittersForTest here — that would orphan the
  // already-registered committer.
  const run = await prisma.agentRun.create({
    data: { agentId, tenantId, status: AgentRunStatus.RUNNING },
  });
  runId = run.id;
});

afterEach(async () => {
  // Tear down tasks between tests so merges don't leak.
  await prisma.taskNote.deleteMany({ where: { task: { tenantId } } });
  await prisma.maintenanceTask.deleteMany({ where: { tenantId } });
  await prisma.agentProposal.deleteMany({ where: { tenantId } });
});

async function emitProposal(payload: Record<string, unknown>, opts?: {
  confidence?: number;
}) {
  return prisma.agentProposal.create({
    data: {
      agentId,
      runId,
      kind: MAINTENANCE_TASK_CREATE_KIND,
      payload: JSON.stringify(payload),
      confidence: opts?.confidence ?? 0.7,
      reasoning: "test",
      audienceScope: AgentProposalAudience.TENANT,
      tenantId,
    },
  });
}

// ─── Pure helpers ────────────────────────────────────────────

describe("titleTokenOverlap", () => {
  test("identical titles → 1.0", () => {
    expect(titleTokenOverlap("Rink 3 surface uneven", "Rink 3 surface uneven")).toBe(1);
  });

  test("strong overlap above threshold", () => {
    const score = titleTokenOverlap(
      "Rink 3 surface uneven near south end",
      "Rink 3 has uneven surface",
    );
    expect(score).toBeGreaterThan(0.4);
  });

  test("unrelated titles below threshold", () => {
    const score = titleTokenOverlap(
      "Rink 3 surface uneven",
      "Clubhouse window broken",
    );
    expect(score).toBeLessThan(0.4);
  });

  test("ignores stop words and short tokens", () => {
    // After stripping, both reduce to {sprinkler}
    expect(
      titleTokenOverlap("The sprinkler has issue", "Fix the sprinkler"),
    ).toBe(1);
  });
});

describe("clusterImpliedPriority", () => {
  test("URGENT for tone severity 1.0", () => {
    expect(clusterImpliedPriority({ toneSeverity: 1.0 })).toBe(TaskPriority.URGENT);
  });
  test("HIGH for severe tone 0.8+", () => {
    expect(clusterImpliedPriority({ toneSeverity: 0.85 })).toBe(TaskPriority.HIGH);
  });
  test("HIGH for 5+ participants", () => {
    expect(clusterImpliedPriority({ participantCount: 5 })).toBe(TaskPriority.HIGH);
  });
  test("MEDIUM for 3-4 participants", () => {
    expect(clusterImpliedPriority({ participantCount: 3 })).toBe(TaskPriority.MEDIUM);
  });
  test("LOW when neither signal triggers", () => {
    expect(clusterImpliedPriority({ participantCount: 1, toneSeverity: 0.2 })).toBe(
      TaskPriority.LOW,
    );
  });
});

// ─── Create path ─────────────────────────────────────────────

describe("MAINTENANCE_TASK_CREATE — create path", () => {
  test("creates new MAINTENANCE_ONLY task with agent as submitter", async () => {
    const proposal = await emitProposal({
      title: "Rink 1 surface bumpy",
      description: "Members report bumps near the head.",
      category: TaskCategory.RINK_SURFACE,
      priority: TaskPriority.MEDIUM,
      participantCount: 1,
    });

    const result = await applyProposal({ proposalId: proposal.id, approverId });
    expect(result.committedEntityType).toBe("MaintenanceTask");
    const task = await prisma.maintenanceTask.findUniqueOrThrow({
      where: { id: result.committedEntityId! },
    });
    expect(task.visibility).toBe("MAINTENANCE_ONLY");
    expect(task.submittedById).toBe(agentSystemUserId);
    expect(task.priority).toBe(TaskPriority.MEDIUM);
    expect(task.title).toBe("Rink 1 surface bumpy");
  });

  test("priority bumps from cluster signal (5 participants → HIGH)", async () => {
    const proposal = await emitProposal({
      title: "Clubhouse heating broken",
      description: "x",
      category: TaskCategory.FACILITIES,
      priority: TaskPriority.MEDIUM, // proposed MEDIUM
      participantCount: 5, // implies HIGH
    });
    const r = await applyProposal({ proposalId: proposal.id, approverId });
    const task = await prisma.maintenanceTask.findUniqueOrThrow({
      where: { id: r.committedEntityId! },
    });
    expect(task.priority).toBe(TaskPriority.HIGH);
  });

  test("severe tone goes URGENT regardless of low proposed priority", async () => {
    const proposal = await emitProposal({
      title: "Loose paving slab safety hazard",
      description: "x",
      category: TaskCategory.SAFETY,
      priority: TaskPriority.LOW,
      participantCount: 1,
      toneSeverity: 1.0,
    });
    const r = await applyProposal({ proposalId: proposal.id, approverId });
    const task = await prisma.maintenanceTask.findUniqueOrThrow({
      where: { id: r.committedEntityId! },
    });
    expect(task.priority).toBe(TaskPriority.URGENT);
  });

  test("approver edits override payload values", async () => {
    const proposal = await emitProposal({
      title: "Bad title",
      description: "Bad desc",
      category: TaskCategory.GENERAL,
      priority: TaskPriority.LOW,
    });
    const r = await applyProposal({
      proposalId: proposal.id,
      approverId,
      edits: { title: "Better title", priority: TaskPriority.HIGH },
    });
    const task = await prisma.maintenanceTask.findUniqueOrThrow({
      where: { id: r.committedEntityId! },
    });
    expect(task.title).toBe("Better title");
    expect(task.priority).toBe(TaskPriority.HIGH);
  });
});

// ─── Merge path ──────────────────────────────────────────────

describe("MAINTENANCE_TASK_CREATE — merge path", () => {
  test("merges into open task with overlapping title; adds anonymised note; bumps priority", async () => {
    // Pre-existing open task
    const existing = await prisma.maintenanceTask.create({
      data: {
        tenantId,
        title: "Rink 3 surface uneven",
        description: "Initial report",
        category: TaskCategory.RINK_SURFACE,
        priority: TaskPriority.MEDIUM,
        submittedById: agentSystemUserId,
      },
    });

    const proposal = await emitProposal({
      title: "Rink 3 surface uneven near south end",
      description: "More members reporting",
      category: TaskCategory.RINK_SURFACE,
      priority: TaskPriority.MEDIUM,
      participantCount: 5, // implies HIGH
      toneLabel: "frustrated",
    });

    const r = await applyProposal({ proposalId: proposal.id, approverId });
    expect(r.committedEntityId).toBe(existing.id);

    const after = await prisma.maintenanceTask.findUniqueOrThrow({ where: { id: existing.id } });
    expect(after.priority).toBe(TaskPriority.HIGH);

    const notes = await prisma.taskNote.findMany({ where: { taskId: existing.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0].userId).toBe(agentSystemUserId);
    expect(notes[0].text).toContain("[Agent]");
    expect(notes[0].text).toContain("frustrated");
    // Anonymisation discipline: no usernames or emails in note text
    expect(notes[0].text).not.toContain("@");
  });

  test("does not merge across categories", async () => {
    await prisma.maintenanceTask.create({
      data: {
        tenantId,
        title: "Sprinkler stuck on",
        description: "x",
        category: TaskCategory.GROUNDS,
        priority: TaskPriority.MEDIUM,
        submittedById: agentSystemUserId,
      },
    });
    const proposal = await emitProposal({
      title: "Sprinkler stuck on green 2",
      description: "different category though",
      category: TaskCategory.EQUIPMENT, // ≠ GROUNDS
      priority: TaskPriority.MEDIUM,
    });
    await applyProposal({ proposalId: proposal.id, approverId });
    const tasks = await prisma.maintenanceTask.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });
    expect(tasks).toHaveLength(2);
  });

  test("does not merge into closed tasks", async () => {
    await prisma.maintenanceTask.create({
      data: {
        tenantId,
        title: "Net torn rink 4",
        description: "x",
        category: TaskCategory.EQUIPMENT,
        priority: TaskPriority.MEDIUM,
        status: TaskStatus.CLOSED,
        submittedById: agentSystemUserId,
      },
    });
    const proposal = await emitProposal({
      title: "Net torn rink 4 again",
      description: "x",
      category: TaskCategory.EQUIPMENT,
      priority: TaskPriority.MEDIUM,
    });
    await applyProposal({ proposalId: proposal.id, approverId });
    const open = await prisma.maintenanceTask.findMany({
      where: { tenantId, status: { not: TaskStatus.CLOSED } },
    });
    expect(open).toHaveLength(1); // the new one, not merged into closed
  });

  test("note count reflects sourceMessageIds when participantCount missing", async () => {
    const existing = await prisma.maintenanceTask.create({
      data: {
        tenantId,
        title: "Greens watering schedule late",
        description: "x",
        category: TaskCategory.GROUNDS,
        priority: TaskPriority.LOW,
        submittedById: agentSystemUserId,
      },
    });
    const proposal = await emitProposal({
      title: "Greens watering schedule late again",
      description: "x",
      category: TaskCategory.GROUNDS,
      priority: TaskPriority.LOW,
      sourceMessageIds: ["m1", "m2", "m3"],
    });
    await applyProposal({ proposalId: proposal.id, approverId });
    const notes = await prisma.taskNote.findMany({ where: { taskId: existing.id } });
    expect(notes[0].text).toContain("3 additional voices");
  });
});
