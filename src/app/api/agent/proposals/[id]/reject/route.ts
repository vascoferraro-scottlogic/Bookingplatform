import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
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

  const { id } = await params;

  const proposal = await prisma.agentProposal.findUnique({ where: { id } });
  if (!proposal) return jsonError("Not found", 404);

  if (!proposal.tenantId) {
    return jsonError("Non-tenant proposals are not approvable here yet", 400);
  }

  const role = session.user.actingAs?.role ?? session.user.role;
  const actingTenantId = session.user.actingAs?.tenantId ?? session.user.tenantId;
  const isPlatformAdmin = role === "PLATFORM_ADMIN";
  const isOnTenant = actingTenantId === proposal.tenantId;
  const hasReviewRole = ["TENANT_ADMIN", "MAINTENANCE"].includes(role);

  if (!(isPlatformAdmin || (isOnTenant && hasReviewRole))) {
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
