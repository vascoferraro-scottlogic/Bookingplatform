/**
 * Committer registry for AgentProposal. See agent strategy plan §B/§C.
 *
 * Discipline:
 *  - Agents NEVER write to domain tables directly. They emit AgentProposal
 *    rows via BaseAgent.emit*Proposal() helpers.
 *  - When a proposal is approved, the registered committer for its `kind`
 *    runs the actual domain write (creating the MaintenanceTask, drafting
 *    the ContentSection, etc).
 *  - The committer must return the (entityType, entityId) it created or
 *    updated, so the proposal can be linked back for audit.
 *
 * Per-kind committers live in sibling files (e.g. `maintenance-task-create.ts`)
 * and self-register on import. The inbox UI (step 4) imports an index file
 * that pulls them all in.
 */

import { prisma } from "@/lib/prisma";
import type { AgentProposal, Prisma } from "@prisma/client";
import { AgentProposalStatus } from "@prisma/client";

/**
 * Result returned by a committer when it has applied a proposal to domain
 * tables. The (entityType, entityId) pair is recorded on the proposal for
 * later audit / history queries.
 */
export interface CommitResult {
  entityType: string;
  entityId: string;
}

/**
 * A committer function: given a loaded proposal, the parsed payload, and
 * optional edits, applies the change to domain tables.
 *
 * `edits` is a partial overlay supplied by the approver during
 * "approve-with-edits". The committer must merge edits over payload before
 * applying, and return the final committed shape via CommitResult so the
 * caller can compute and store the payload diff.
 */
export type Committer<TPayload = unknown> = (input: {
  proposal: AgentProposal;
  payload: TPayload;
  edits?: Partial<TPayload>;
  approverId: string;
}) => Promise<CommitResult>;

const REGISTRY = new Map<string, Committer<unknown>>();

/**
 * Register a committer for a proposal kind. Should be called at module load
 * time from the per-kind file (e.g. `committers/maintenance-task-create.ts`).
 *
 * Throws if a committer is already registered for the kind — there is exactly
 * one canonical way to apply each kind.
 */
export function registerCommitter<TPayload>(
  kind: string,
  fn: Committer<TPayload>,
): void {
  if (REGISTRY.has(kind)) {
    throw new Error(
      `Committer already registered for kind "${kind}" — registration must be unique.`,
    );
  }
  REGISTRY.set(kind, fn as Committer<unknown>);
}

/**
 * Test/cleanup helper. Production code should not call this.
 */
export function _resetCommittersForTest(): void {
  REGISTRY.clear();
}

/**
 * Get a committer for a kind, throwing if none registered. Useful for the
 * inbox UI to indicate "this proposal kind has no committer wired up yet"
 * with a precise error.
 */
export function getCommitter(kind: string): Committer<unknown> {
  const fn = REGISTRY.get(kind);
  if (!fn) {
    throw new Error(
      `No committer registered for proposal kind "${kind}". ` +
        `Make sure src/lib/agent/committers/index.ts imports the file that registers it.`,
    );
  }
  return fn;
}

/**
 * Returns true if a committer is registered for the kind. Use in UI to
 * disable the Approve button gracefully rather than waiting for the throw.
 */
export function hasCommitter(kind: string): boolean {
  return REGISTRY.has(kind);
}

/**
 * Approve a proposal: parse payload + edits, look up committer, apply.
 *
 * On success the proposal moves PENDING → APPROVED with commit metadata
 * (entity ref, payload diff, approver, timestamp).
 *
 * Throws if: proposal not found, not PENDING, no committer registered,
 * or committer itself throws.
 *
 * Auth (effective role check, cross-tenant approver-still-has-rights
 * verification for USER-scope proposals targeting other tenants) is the
 * caller's responsibility — typically the inbox API route enforces it
 * before calling this.
 */
export async function applyProposal(input: {
  proposalId: string;
  approverId: string;
  edits?: Record<string, unknown>;
}): Promise<AgentProposal> {
  const proposal = await prisma.agentProposal.findUnique({
    where: { id: input.proposalId },
  });
  if (!proposal) {
    throw new Error(`Proposal ${input.proposalId} not found`);
  }
  if (proposal.status !== AgentProposalStatus.PENDING) {
    throw new Error(
      `Proposal ${input.proposalId} is ${proposal.status}, can only commit PENDING proposals`,
    );
  }

  const committer = getCommitter(proposal.kind);
  let payload: unknown;
  try {
    payload = JSON.parse(proposal.payload);
  } catch {
    throw new Error(`Proposal ${input.proposalId} payload is not valid JSON`);
  }

  const edits = input.edits;
  const result = await committer({
    proposal,
    payload,
    edits,
    approverId: input.approverId,
  });

  // Compute a simple diff representation when edits were applied. We store the
  // raw edits JSON; downstream consumers (training-data exporter, audit UI)
  // can render this however they like.
  const diff = edits && Object.keys(edits).length > 0 ? JSON.stringify(edits) : null;

  return prisma.agentProposal.update({
    where: { id: input.proposalId },
    data: {
      status: AgentProposalStatus.APPROVED,
      committedAt: new Date(),
      committedById: input.approverId,
      committedEntityType: result.entityType,
      committedEntityId: result.entityId,
      committedPayloadDiff: diff,
    },
  });
}

/**
 * Reject a proposal. Status PENDING → REJECTED with reason.
 *
 * `reason` is free-text. The strategy plan §L.4 calls out free-text reject
 * reasons as a critical training-data signal — UI should encourage filling
 * this in (placeholder text, "Skip" button only on snooze).
 */
export async function rejectProposal(input: {
  proposalId: string;
  rejecterId: string;
  reason?: string;
}): Promise<AgentProposal> {
  const proposal = await prisma.agentProposal.findUnique({
    where: { id: input.proposalId },
  });
  if (!proposal) {
    throw new Error(`Proposal ${input.proposalId} not found`);
  }
  if (proposal.status !== AgentProposalStatus.PENDING) {
    throw new Error(
      `Proposal ${input.proposalId} is ${proposal.status}, can only reject PENDING proposals`,
    );
  }

  return prisma.agentProposal.update({
    where: { id: input.proposalId },
    data: {
      status: AgentProposalStatus.REJECTED,
      rejectedAt: new Date(),
      rejectedById: input.rejecterId,
      rejectReason: input.reason ?? null,
    },
  });
}

/**
 * Re-export the Prisma type alias for committer authors who want type-safe
 * payloads. Pattern:
 *
 *   interface MaintenanceTaskCreatePayload {
 *     title: string;
 *     description: string;
 *     priority: TaskPriority;
 *   }
 *
 *   registerCommitter<MaintenanceTaskCreatePayload>(
 *     "MAINTENANCE_TASK_CREATE",
 *     async ({ payload, edits, proposal, approverId }) => {
 *       const merged = { ...payload, ...edits };
 *       const task = await prisma.maintenanceTask.create({ ... });
 *       return { entityType: "MaintenanceTask", entityId: task.id };
 *     },
 *   );
 */
export type AgentProposalRow = Prisma.AgentProposalGetPayload<Record<string, never>>;
