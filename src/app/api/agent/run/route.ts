import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { isFeatureEnabled } from "@/lib/features";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { AGENT_ORDER, getAgent, getAllAgents } from "@/lib/agent/registry";
import { hasRole } from "@/lib/roles";

/**
 * POST /api/agent/run
 *
 * Triggers an agent run for the caller's tenant. Body: `{ agentSlug?: string }`.
 * When agentSlug is omitted, all enabled agents run in `AGENT_ORDER`.
 *
 * Auth modes (either is sufficient):
 *  - Bearer token in `Authorization: Bearer <AGENT_SECRET>` + `?tenantId=` (server-to-server cron)
 *  - Logged-in TENANT_ADMIN session for their own tenant
 */
export async function POST(req: NextRequest) {
  const { tenantId, viaSecret, error } = await authoriseRun(req);
  if (error) return error;

  if (!(await isFeatureEnabled(tenantId, "agent"))) {
    return jsonError("Agent system is not enabled for this club", 403);
  }

  const body = await req.json().catch(() => ({}));
  const agentSlug: string | undefined = typeof body.agentSlug === "string" ? body.agentSlug : undefined;

  const slugs = agentSlug ? [agentSlug] : AGENT_ORDER;
  const results: Array<{ agent: string; runId?: string; status: string; summary?: unknown; error?: string }> = [];

  for (const slug of slugs) {
    const agent = getAgent(slug);
    if (!agent) {
      results.push({ agent: slug, status: "UNKNOWN_AGENT", error: `No agent with slug "${slug}"` });
      continue;
    }
    try {
      const run = await agent.runForTenant(tenantId);
      results.push({
        agent: slug,
        runId: run.id,
        status: run.status,
        summary: run.summary ? safeParse(run.summary) : undefined,
        error: run.error ?? undefined,
      });
    } catch (e) {
      results.push({ agent: slug, status: "FAILED", error: (e as Error).message });
    }
  }

  if (!viaSecret) {
    // Audit only when an interactive admin triggered it (cron noise = bad)
    const { session } = await getSessionOrFail();
    if (session) {
      logAudit({
        session,
        action: "agent.run",
        entity: "AgentRun",
        tenantId,
        meta: { slugs, results: results.map((r) => ({ agent: r.agent, status: r.status })) },
      });
    }
  }

  return NextResponse.json({ tenantId, runs: results });
}

/**
 * GET /api/agent/run?listAgents=1
 *
 * Returns the list of registered agents (for UI selection).
 */
export async function GET() {
  return NextResponse.json({
    agents: getAllAgents().map((a) => ({ slug: a.slug, name: a.displayName })),
    order: AGENT_ORDER,
  });
}

async function authoriseRun(
  req: NextRequest,
): Promise<{ tenantId: string; viaSecret: boolean; error?: undefined } | { tenantId?: undefined; viaSecret?: undefined; error: NextResponse }> {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.AGENT_SECRET;
  if (secret && auth === `Bearer ${secret}`) {
    const tenantIdParam = req.nextUrl.searchParams.get("tenantId");
    if (!tenantIdParam) {
      return { error: jsonError("tenantId query parameter required when using bearer token", 400) };
    }
    return { tenantId: tenantIdParam, viaSecret: true };
  }

  const { session, error } = await getSessionOrFail();
  if (error) return { error };
  if (!hasRole(session.user.role, "TENANT_ADMIN") && !session.user.actingAs) {
    return { error: jsonError("Forbidden", 403) };
  }
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return { error: tErr };
  return { tenantId, viaSecret: false };
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
