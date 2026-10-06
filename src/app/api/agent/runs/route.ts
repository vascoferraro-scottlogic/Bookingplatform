import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { hasRole } from "@/lib/roles";

/**
 * GET /api/agent/runs — list recent agent runs for the active tenant.
 * Query: ?agentSlug=&status=&limit=  (default limit 50, max 200)
 *
 * MAINTENANCE+ only — used by the agent dashboard for monitoring/debugging.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  if (!hasRole(getEffective(session).role, "MAINTENANCE")) return jsonError("Forbidden", 403);

  const { searchParams } = new URL(req.url);
  const agentSlug = searchParams.get("agentSlug");
  const status = searchParams.get("status");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);

  const where: Record<string, unknown> = { tenantId };
  if (agentSlug) {
    const def = await prisma.agentDefinition.findUnique({ where: { slug: agentSlug } });
    if (!def) return NextResponse.json({ runs: [] });
    where.agentId = def.id;
  }
  if (status) where.status = status;

  const runs = await prisma.agentRun.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: limit,
    include: { agent: { select: { slug: true, name: true } } },
  });

  return NextResponse.json({
    runs: runs.map(r => ({
      id: r.id,
      agent: r.agent,
      status: r.status,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      durationMs: r.completedAt ? r.completedAt.getTime() - r.startedAt.getTime() : null,
      summary: r.summary ? safeParse(r.summary) : null,
      error: r.error,
    })),
  });
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
