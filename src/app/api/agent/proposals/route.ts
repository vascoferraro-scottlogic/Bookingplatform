import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { AgentProposalStatus } from "@prisma/client";

/**
 * GET /api/agent/proposals
 *
 * List proposals for the current tenant. TENANT_ADMIN + MAINTENANCE +
 * PLATFORM_ADMIN may view. Returns pending by default; pass ?status=ALL to
 * include other statuses (recently approved/rejected for context).
 *
 * Query: ?status=PENDING|APPROVED|REJECTED|SUPERSEDED|EXPIRED|ALL
 *        ?kind=MAINTENANCE_TASK_CREATE
 *        ?limit=50
 */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const role = session.user.actingAs?.role ?? session.user.role;
  if (!["TENANT_ADMIN", "MAINTENANCE", "PLATFORM_ADMIN"].includes(role)) {
    return jsonError("Forbidden", 403);
  }

  const sp = req.nextUrl.searchParams;
  const statusParam = (sp.get("status") ?? "PENDING").toUpperCase();
  const kind = sp.get("kind");
  const limit = Math.min(Number(sp.get("limit") ?? 50), 200);

  const statusFilter =
    statusParam === "ALL"
      ? {}
      : Object.values(AgentProposalStatus).includes(statusParam as AgentProposalStatus)
        ? { status: statusParam as AgentProposalStatus }
        : { status: AgentProposalStatus.PENDING };

  const proposals = await prisma.agentProposal.findMany({
    where: {
      tenantId,
      ...statusFilter,
      ...(kind ? { kind } : {}),
    },
    include: {
      agent: { select: { slug: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  // Parse payloads for client convenience.
  const hydrated = proposals.map((p) => ({
    ...p,
    payloadParsed: safeJsonParse(p.payload),
    committedPayloadDiffParsed: p.committedPayloadDiff ? safeJsonParse(p.committedPayloadDiff) : null,
  }));

  return NextResponse.json({ proposals: hydrated });
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
