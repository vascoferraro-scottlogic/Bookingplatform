import { moduleFlagOrFail } from "@/lib/features";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";
import { rejectProposal } from "@/lib/agent/committers";

/**
 * POST /api/agent/proposals/[id]/reject
 *
 * Body: { reason?: string }
 *
 * Free-text reason is the critical training-data signal — UI should
 * encourage filling it in (placeholder text, not optional in the form even
 * though the API accepts empty).
 *
 * Auth: same as approve.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const flagErr = await moduleFlagOrFail(session, "agent");
  if (flagErr) return flagErr;

  const { id } = await params;

  const proposal = await prisma.agentProposal.findUnique({ where: { id } });
  if (!proposal) return jsonError("Not found", 404);

  if (!proposal.tenantId) {
    return jsonError("Non-tenant proposals are not approvable here yet", 400);
  }

  // Effective role: a platform admin must be impersonating the tenant first.
  const roleErr = assertEffectiveRoleOrFail(session, "MAINTENANCE");
  if (roleErr) return roleErr;
  if (getEffective(session).tenantId !== proposal.tenantId) {
    return jsonError("Forbidden", 403);
  }

  let body: { reason?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Reason is optional.
  }

  let updated;
  try {
    updated = await rejectProposal({
      proposalId: id,
      rejecterId: session.user.id,
      reason: body.reason,
    });
  } catch (e) {
    return jsonError((e as Error).message, 400);
  }

  logAudit({
    session,
    action: "agent.proposal.rejected",
    entity: "AgentProposal",
    entityId: id,
    tenantId: proposal.tenantId,
    meta: { kind: proposal.kind, reason: body.reason ?? null },
  });

  return NextResponse.json(updated);
}
