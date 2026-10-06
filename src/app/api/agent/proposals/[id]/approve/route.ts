import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";
import { applyProposal } from "@/lib/agent/committers";
// Side-effect import: ensures all per-kind committers are registered before
// applyProposal is called. New committer files must also be added to
// register-all.ts.
import "@/lib/agent/committers/register-all";

/**
 * POST /api/agent/proposals/[id]/approve
 *
 * Body: { edits?: object }
 *
 * Auth: TENANT_ADMIN or MAINTENANCE on the proposal's tenant. Cross-tenant
 * approver checks for USER-scope proposals are the committer's responsibility
 * (it sees the proposal row + can re-verify membership).
 *
 * Returns the updated proposal row including commit metadata.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;

  const proposal = await prisma.agentProposal.findUnique({ where: { id } });
  if (!proposal) return jsonError("Not found", 404);

  // Tenant-scoped auth: approver must be admin/maintenance on the proposal's
  // tenant. Platform-scoped proposals are reviewed elsewhere (deferred).
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

  let body: { edits?: Record<string, unknown> } = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is allowed — approve as-is.
  }

  let updated;
  try {
    updated = await applyProposal({
      proposalId: id,
      approverId: session.user.id,
      edits: body.edits,
    });
  } catch (e) {
    const msg = (e as Error).message;
    // PENDING-only / not-found / no-committer errors all map to 400.
    return jsonError(msg, 400);
  }

  logAudit({
    session,
    action: "agent.proposal.approved",
    entity: "AgentProposal",
    entityId: id,
    tenantId: proposal.tenantId,
    meta: {
      kind: proposal.kind,
      committedEntityType: updated.committedEntityType,
      committedEntityId: updated.committedEntityId,
      hasEdits: !!body.edits && Object.keys(body.edits).length > 0,
    },
  });

  return NextResponse.json(updated);
}
