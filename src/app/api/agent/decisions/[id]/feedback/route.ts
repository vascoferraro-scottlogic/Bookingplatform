import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { hasRole } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import {
  AssignmentFeedback,
  PriorityFeedback,
  ValidityFeedback,
} from "@prisma/client";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/agent/decisions/[id]/feedback
 *
 * Two-level feedback for an agent decision:
 *   - validity: was it right to act here at all?  (CORRECT | INCORRECT)
 *   - priority: was the priority right?           (CORRECT | TOO_HIGH | TOO_LOW)
 *   - assignment: was the assignee right?         (CORRECT | WRONG_PERSON)
 *
 * Each is independent. Body may include any subset plus an optional `note`.
 *
 * Requires MAINTENANCE role minimum (effective).
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  if (!hasRole(getEffective(session).role, "MAINTENANCE")) {
    return jsonError("Forbidden", 403);
  }

  const { id } = await ctx.params;
  const decision = await prisma.agentDecision.findUnique({ where: { id } });
  if (!decision || decision.tenantId !== tenantId) {
    return jsonError("Decision not found", 404);
  }

  const body = await req.json().catch(() => ({}));
  const validity = parseEnum(body.validity, ValidityFeedback);
  const priority = parseEnum(body.priority, PriorityFeedback);
  const assignment = parseEnum(body.assignment, AssignmentFeedback);
  const note = typeof body.note === "string" ? body.note.slice(0, 1000) : undefined;

  if (!validity && !priority && !assignment && !note) {
    return jsonError("At least one of validity / priority / assignment / note required", 400);
  }

  const feedback = await prisma.agentFeedback.upsert({
    where: { decisionId: id },
    create: {
      decisionId: id,
      validityFeedback: validity ?? null,
      priorityFeedback: priority ?? null,
      assignmentFeedback: assignment ?? null,
      note: note ?? null,
      givenById: session.user.id,
    },
    update: {
      validityFeedback: validity ?? undefined,
      priorityFeedback: priority ?? undefined,
      assignmentFeedback: assignment ?? undefined,
      note: note ?? undefined,
      givenById: session.user.id,
    },
  });

  logAudit({
    session,
    action: "agent.feedback",
    entity: "AgentDecision",
    entityId: id,
    tenantId,
    meta: { validity, priority, assignment, hasNote: !!note },
  });

  return NextResponse.json(feedback);
}

function parseEnum<T extends Record<string, string>>(value: unknown, e: T): T[keyof T] | undefined {
  if (typeof value !== "string") return undefined;
  return Object.values(e).includes(value as T[keyof T]) ? (value as T[keyof T]) : undefined;
}
