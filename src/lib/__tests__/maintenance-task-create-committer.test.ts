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
jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);

import {
  AgentProposalAudience,
  AgentProposalStatus,
  TaskCategory,
  TaskPriority,
  TaskStatus,
} from "@prisma/client";
import { prismaMock } from "@/test-utils/prisma-mock";
import { applyProposal } from "@/lib/agent/committers";
import {
  MAINTENANCE_TASK_CREATE_KIND,
  clusterImpliedPriority,
  titleTokenOverlap,
} from "@/lib/agent/committers/maintenance-task-create";
// Side-effect import: registers the committer once for the whole suite.
import "@/lib/agent/committers/register-all";

const tenantId = "tenant-1";
const approverId = "approver-1";
const agentId = "agent-1";
const agentSystemUserId = "sys-agent";

beforeEach(() => {
  prismaMock.agentDefinition.findUnique.mockResolvedValue({ systemUserId: agentSystemUserId } as never);
  // No open candidate tasks unless a test says otherwise.
  prismaMock.maintenanceTask.findMany.mockResolvedValue([]);
  prismaMock.maintenanceTask.create.mockImplementation((async ({ data }: any) => ({ id: "new-task", ...data })) as never);
  prismaMock.agentProposal.update.mockImplementation((async ({ where, data }: any) => ({ id: where.id, ...data })) as never);
});

/** A PENDING proposal that applyProposal will load. */
function emitProposal(payload: Record<string, unknown>, opts?: { confidence?: number }) {
  const proposal = {
    id: "proposal-1",
    agentId,
    runId: "run-1",
    kind: MAINTENANCE_TASK_CREATE_KIND,
    payload: JSON.stringify(payload),
    confidence: opts?.confidence ?? 0.7,
    reasoning: "test",
    audienceScope: AgentProposalAudience.TENANT,
    tenantId,
    targetTenantId: null,
    status: AgentProposalStatus.PENDING,
  };
  prismaMock.agentProposal.findUnique.mockResolvedValue(proposal as never);
  return proposal;
}

/** Open tasks returned by the merge-candidate query. */
function givenOpenTasks(tasks: Array<{ id: string; title: string; priority: TaskPriority }>) {
  prismaMock.maintenanceTask.findMany.mockResolvedValue(tasks as never);
}

const createdTask = () => (prismaMock.maintenanceTask.create.mock.calls[0][0] as any).data;
const candidateQuery = () => (prismaMock.maintenanceTask.findMany.mock.calls[0][0] as any).where;

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
    const proposal = emitProposal({
      title: "Rink 1 surface bumpy",
      description: "Members report bumps near the head.",
      category: TaskCategory.RINK_SURFACE,
      priority: TaskPriority.MEDIUM,
      participantCount: 1,
    });

    const result = await applyProposal({ proposalId: proposal.id, approverId });

    expect(result.committedEntityType).toBe("MaintenanceTask");
    expect(result.committedEntityId).toBe("new-task");
    expect(prismaMock.agentDefinition.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: agentId } }),
    );
    const task = createdTask();
    // Visibility omitted so the schema default (MAINTENANCE_ONLY) applies.
    expect(task).not.toHaveProperty("visibility");
    expect(task.tenantId).toBe(tenantId);
    expect(task.submittedById).toBe(agentSystemUserId);
    expect(task.priority).toBe(TaskPriority.MEDIUM);
    expect(task.title).toBe("Rink 1 surface bumpy");
  });

  test("priority bumps from cluster signal (5 participants → HIGH)", async () => {
    const proposal = emitProposal({
      title: "Clubhouse heating broken",
      description: "x",
      category: TaskCategory.FACILITIES,
      priority: TaskPriority.MEDIUM, // proposed MEDIUM
      participantCount: 5, // implies HIGH
    });
    await applyProposal({ proposalId: proposal.id, approverId });
    expect(createdTask().priority).toBe(TaskPriority.HIGH);
  });

  test("severe tone goes URGENT regardless of low proposed priority", async () => {
    const proposal = emitProposal({
      title: "Loose paving slab safety hazard",
      description: "x",
      category: TaskCategory.SAFETY,
      priority: TaskPriority.LOW,
      participantCount: 1,
      toneSeverity: 1.0,
    });
    await applyProposal({ proposalId: proposal.id, approverId });
    expect(createdTask().priority).toBe(TaskPriority.URGENT);
  });

  test("approver edits override payload values", async () => {
    const proposal = emitProposal({
      title: "Bad title",
      description: "Bad desc",
      category: TaskCategory.GENERAL,
      priority: TaskPriority.LOW,
    });
    await applyProposal({
      proposalId: proposal.id,
      approverId,
      edits: { title: "Better title", priority: TaskPriority.HIGH },
    });
    const task = createdTask();
    expect(task.title).toBe("Better title");
    expect(task.priority).toBe(TaskPriority.HIGH);
  });
});

// ─── Merge path ──────────────────────────────────────────────

describe("MAINTENANCE_TASK_CREATE — merge path", () => {
  test("merges into open task with overlapping title; adds anonymised note; bumps priority", async () => {
    // Pre-existing open task
    givenOpenTasks([{ id: "existing", title: "Rink 3 surface uneven", priority: TaskPriority.MEDIUM }]);

    const proposal = emitProposal({
      title: "Rink 3 surface uneven near south end",
      description: "More members reporting",
      category: TaskCategory.RINK_SURFACE,
      priority: TaskPriority.MEDIUM,
      participantCount: 5, // implies HIGH
      toneLabel: "frustrated",
    });

    const r = await applyProposal({ proposalId: proposal.id, approverId });
    expect(r.committedEntityId).toBe("existing");
    expect(prismaMock.maintenanceTask.create).not.toHaveBeenCalled();

    expect(prismaMock.maintenanceTask.update).toHaveBeenCalledWith({
      where: { id: "existing" },
      data: { priority: TaskPriority.HIGH },
    });

    expect(prismaMock.taskNote.create).toHaveBeenCalledTimes(1);
    const note = (prismaMock.taskNote.create.mock.calls[0][0] as any).data;
    expect(note.taskId).toBe("existing");
    expect(note.userId).toBe(agentSystemUserId);
    expect(note.text).toContain("[Agent]");
    expect(note.text).toContain("frustrated");
    // Anonymisation discipline: no usernames or emails in note text
    expect(note.text).not.toContain("@");
  });

  test("only considers open tasks in the same tenant and category from the last 30 days", async () => {
    const proposal = emitProposal({
      title: "Sprinkler stuck on green 2",
      description: "x",
      category: TaskCategory.EQUIPMENT,
      priority: TaskPriority.MEDIUM,
    });
    const before = Date.now();

    await applyProposal({ proposalId: proposal.id, approverId });

    const where = candidateQuery();
    expect(where.tenantId).toBe(tenantId);
    expect(where.category).toBe(TaskCategory.EQUIPMENT);
    expect(where.status.in).toEqual(
      expect.arrayContaining([TaskStatus.SUBMITTED, TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS]),
    );
    expect(where.status.in).not.toContain(TaskStatus.CLOSED);
    const windowMs = before - (where.createdAt.gt as Date).getTime();
    expect(windowMs).toBeGreaterThanOrEqual(30 * 24 * 3_600_000 - 1_000);
    expect(windowMs).toBeLessThanOrEqual(30 * 24 * 3_600_000 + 1_000);
  });

  test("does not merge across categories", async () => {
    // The only similar task is GROUNDS; the EQUIPMENT candidate query finds nothing.
    const proposal = emitProposal({
      title: "Sprinkler stuck on green 2",
      description: "different category though",
      category: TaskCategory.EQUIPMENT, // ≠ GROUNDS
      priority: TaskPriority.MEDIUM,
    });
    await applyProposal({ proposalId: proposal.id, approverId });

    expect(candidateQuery().category).toBe(TaskCategory.EQUIPMENT);
    expect(prismaMock.maintenanceTask.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.taskNote.create).not.toHaveBeenCalled();
  });

  test("does not merge into closed tasks", async () => {
    // A CLOSED "Net torn rink 4" exists, but the open-status query excludes it.
    const proposal = emitProposal({
      title: "Net torn rink 4 again",
      description: "x",
      category: TaskCategory.EQUIPMENT,
      priority: TaskPriority.MEDIUM,
    });
    await applyProposal({ proposalId: proposal.id, approverId });

    expect(candidateQuery().status.in).not.toContain(TaskStatus.CLOSED);
    expect(prismaMock.maintenanceTask.create).toHaveBeenCalledTimes(1); // the new one, not merged into closed
    expect(prismaMock.taskNote.create).not.toHaveBeenCalled();
  });

  test("creates a new task when no open candidate has enough title overlap", async () => {
    givenOpenTasks([{ id: "unrelated", title: "Clubhouse window broken", priority: TaskPriority.LOW }]);
    const proposal = emitProposal({
      title: "Rink 3 surface uneven",
      description: "x",
      category: TaskCategory.RINK_SURFACE,
      priority: TaskPriority.MEDIUM,
    });

    const r = await applyProposal({ proposalId: proposal.id, approverId });

    expect(r.committedEntityId).toBe("new-task");
    expect(prismaMock.taskNote.create).not.toHaveBeenCalled();
    expect(prismaMock.maintenanceTask.update).not.toHaveBeenCalled();
  });

  test("note count reflects sourceMessageIds when participantCount missing", async () => {
    givenOpenTasks([{ id: "existing", title: "Greens watering schedule late", priority: TaskPriority.LOW }]);
    const proposal = emitProposal({
      title: "Greens watering schedule late again",
      description: "x",
      category: TaskCategory.GROUNDS,
      priority: TaskPriority.LOW,
      sourceMessageIds: ["m1", "m2", "m3"],
    });
    await applyProposal({ proposalId: proposal.id, approverId });
    const note = (prismaMock.taskNote.create.mock.calls[0][0] as any).data;
    expect(note.taskId).toBe("existing");
    expect(note.text).toContain("3 additional voices");
    // Priority already at max(LOW, LOW, LOW) — no update.
    expect(prismaMock.maintenanceTask.update).not.toHaveBeenCalled();
  });
});
