/**
 * Committer for proposal kind `MAINTENANCE_TASK_CREATE`.
 *
 * Smart merge discipline (decisions log 2026-05-03):
 *  - Look for an open task in the same tenant + category created in the
 *    last MERGE_WINDOW_DAYS that has a strong title token-overlap with the
 *    proposed title. If found, MERGE — add an anonymised TaskNote and
 *    recompute priority — instead of creating a duplicate.
 *  - Otherwise create a new task. Agent-emitted tasks omit `visibility`
 *    so they default to `MAINTENANCE_ONLY` per schema. The maintenance
 *    team promotes via PATCH /api/maintenance/[id]/visibility after triage.
 *
 * Anonymisation discipline (plan §A.8): the committed task carries no FK
 * back to source messages or authors. Provenance lives only on
 * AgentDecision.sourceMessageId. The TaskNote text MUST NOT name the
 * speaker(s) — only counts.
 *
 * Priority signal model (plan §A.11): max of
 *   - explicit edit (approver overrode)
 *   - proposal payload priority (agent's call from clustering)
 *   - participant-count bump (≥3 distinct voices ⇒ at least HIGH)
 *   - tone severity bump (≥0.8 severe tone ⇒ at least HIGH; 1.0 ⇒ URGENT)
 */

import { prisma } from "@/lib/prisma";
import {
  TaskCategory,
  TaskPriority,
  TaskStatus,
} from "@prisma/client";
import { registerCommitter, type CommitResult } from "./index";

export const MAINTENANCE_TASK_CREATE_KIND = "MAINTENANCE_TASK_CREATE";

const MERGE_WINDOW_DAYS = 30;
const TOKEN_OVERLAP_THRESHOLD = 0.4;

export interface MaintenanceTaskCreatePayload {
  title: string;
  description: string;
  category: TaskCategory;
  priority: TaskPriority;
  /** Anonymised — used only to size the cluster and dedupe at apply-time. */
  sourceMessageIds?: string[];
  /** Distinct participants in the cluster. Drives priority. */
  participantCount?: number;
  /** 0..1; 1.0 = safety-critical / explicit anger. Drives priority. */
  toneSeverity?: number;
  /** Free-text tone label for note context (e.g. "frustrated", "concerned"). */
  toneLabel?: string;
}

const PRIORITY_LADDER: TaskPriority[] = [
  TaskPriority.LOW,
  TaskPriority.MEDIUM,
  TaskPriority.HIGH,
  TaskPriority.URGENT,
];

function maxPriority(...priorities: TaskPriority[]): TaskPriority {
  let highest: TaskPriority = TaskPriority.LOW;
  for (const p of priorities) {
    if (PRIORITY_LADDER.indexOf(p) > PRIORITY_LADDER.indexOf(highest)) {
      highest = p;
    }
  }
  return highest;
}

/**
 * Compute the priority bump implied by participant count + tone severity.
 * Returns the *minimum* priority the cluster justifies; the committer takes
 * the max of this against the proposed priority.
 */
export function clusterImpliedPriority(input: {
  participantCount?: number;
  toneSeverity?: number;
}): TaskPriority {
  const count = input.participantCount ?? 1;
  const tone = input.toneSeverity ?? 0;

  if (tone >= 1.0) return TaskPriority.URGENT;
  if (tone >= 0.8) return TaskPriority.HIGH;
  if (count >= 5) return TaskPriority.HIGH;
  if (count >= 3) return TaskPriority.MEDIUM;
  return TaskPriority.LOW;
}

/**
 * Token-overlap similarity between two titles (Jaccard on lowercased
 * word tokens, ignoring trivial stop-words and tokens shorter than 3
 * chars). Cheap and dependency-free; embeddings are a later upgrade.
 */
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "has", "have",
  "needs", "needs.", "issue", "problem", "task", "please", "fix",
]);

export function titleTokenOverlap(a: string, b: string): number {
  const tok = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
    );
  const ta = tok(a);
  const tb = tok(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const w of ta) if (tb.has(w)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

registerCommitter<MaintenanceTaskCreatePayload>(
  MAINTENANCE_TASK_CREATE_KIND,
  async ({ proposal, payload, edits }): Promise<CommitResult> => {
    const merged: MaintenanceTaskCreatePayload = {
      ...payload,
      ...(edits ?? {}),
    };

    if (!proposal.tenantId && !proposal.targetTenantId) {
      throw new Error(
        `MAINTENANCE_TASK_CREATE proposal ${proposal.id} has no tenantId or targetTenantId`,
      );
    }
    const tenantId = proposal.targetTenantId ?? proposal.tenantId!;

    // Determine the system actor for the TaskNote on merge: the agent's
    // systemUser, not the approver. The note represents the agent's
    // observation, not the approver's edit.
    const definition = await prisma.agentDefinition.findUnique({
      where: { id: proposal.agentId },
      select: { systemUserId: true },
    });
    if (!definition) {
      throw new Error(`AgentDefinition ${proposal.agentId} not found`);
    }

    // Look for a candidate open task to merge into.
    const since = new Date(Date.now() - MERGE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const candidates = await prisma.maintenanceTask.findMany({
      where: {
        tenantId,
        category: merged.category,
        status: {
          in: [TaskStatus.SUBMITTED, TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS],
        },
        createdAt: { gt: since },
      },
      select: { id: true, title: true, priority: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    let bestMatch: { id: string; title: string; priority: TaskPriority } | null = null;
    let bestScore = 0;
    for (const c of candidates) {
      const score = titleTokenOverlap(merged.title, c.title);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = c;
      }
    }

    const implied = clusterImpliedPriority({
      participantCount: merged.participantCount,
      toneSeverity: merged.toneSeverity,
    });

    if (bestMatch && bestScore >= TOKEN_OVERLAP_THRESHOLD) {
      // ── Merge path ──
      const recomputed = maxPriority(bestMatch.priority, merged.priority, implied);
      const noteText = buildAnonymisedNote(merged);
      await prisma.taskNote.create({
        data: {
          taskId: bestMatch.id,
          userId: definition.systemUserId,
          text: noteText,
        },
      });
      if (recomputed !== bestMatch.priority) {
        await prisma.maintenanceTask.update({
          where: { id: bestMatch.id },
          data: { priority: recomputed },
        });
      }
      return { entityType: "MaintenanceTask", entityId: bestMatch.id };
    }

    // ── Create path ──
    const initialPriority = maxPriority(merged.priority, implied);
    const task = await prisma.maintenanceTask.create({
      data: {
        tenantId,
        title: merged.title,
        description: merged.description,
        category: merged.category,
        priority: initialPriority,
        // Visibility intentionally omitted: defaults to MAINTENANCE_ONLY
        // per schema (plan §A.8).
        submittedById: definition.systemUserId,
      },
    });
    return { entityType: "MaintenanceTask", entityId: task.id };
  },
);

function buildAnonymisedNote(p: MaintenanceTaskCreatePayload): string {
  const count = p.participantCount ?? p.sourceMessageIds?.length ?? 1;
  const tone = p.toneLabel ? ` (tone: ${p.toneLabel})` : "";
  const voices = count === 1 ? "another voice" : `${count} additional voices`;
  return `[Agent] Cluster merged: ${voices}${tone} reported a similar issue.`;
}
