import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { hasRole } from "@/lib/roles";

type Ctx = { params: Promise<{ taskId: string }> };

/**
 * GET /api/agent/tasks/[taskId]/interactions
 *
 * Lists every agent interaction (CREATED, CONTEXT_ADDED, ASSIGNED, etc.)
 * recorded against a maintenance task, hydrated with the underlying decision
 * (action, confidence, reasoning, agent name).
 *
 * MAINTENANCE+ only. Used by the task detail page to render the "agent
 * timeline" — what the agents did, when, and why.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  if (!hasRole(getEffective(session).role, "MAINTENANCE")) return jsonError("Forbidden", 403);

  const { taskId } = await ctx.params;
  const task = await prisma.maintenanceTask.findUnique({
    where: { id: taskId },
    select: { tenantId: true },
  });
  if (!task) return jsonError("Task not found", 404);
  if (task.tenantId !== tenantId) return jsonError("Forbidden", 403);

  const interactions = await prisma.taskAgentInteraction.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
    include: {
      decision: {
        include: { agent: { select: { slug: true, name: true } } },
      },
    },
  });

  return NextResponse.json({
    interactions: interactions.map(i => ({
      id: i.id,
      type: i.interactionType,
      createdAt: i.createdAt,
      decision: {
        id: i.decision.id,
        action: i.decision.action,
        confidence: i.decision.confidence,
        reasoning: i.decision.reasoning,
        agent: i.decision.agent,
        previousPriority: i.decision.previousPriority,
        newPriority: i.decision.newPriority,
        contextAdded: i.decision.contextAdded,
      },
    })),
  });
}
