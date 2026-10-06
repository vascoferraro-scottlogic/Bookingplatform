import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { hasRole } from "@/lib/roles";
import { logAudit } from "@/lib/audit";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * GET  /api/agent/[slug]/config — fetch the per-tenant config for an agent.
 * PATCH /api/agent/[slug]/config — update enabled flag and/or config JSON.
 *
 * TENANT_ADMIN+ only. Config blob is opaque to this route — agents read their
 * own keys with their own defaults.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  if (!hasRole(getEffective(session).role, "TENANT_ADMIN")) return jsonError("Forbidden", 403);

  const { slug } = await ctx.params;
  const def = await prisma.agentDefinition.findUnique({ where: { slug } });
  if (!def) return jsonError("Unknown agent", 404);

  const row = await prisma.agentConfig.findUnique({
    where: { agentId_tenantId: { agentId: def.id, tenantId } },
  });

  return NextResponse.json({
    agent: { slug: def.slug, name: def.name },
    enabled: row?.enabled ?? true,
    config: row ? safeParse(row.config) : {},
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  if (!hasRole(getEffective(session).role, "TENANT_ADMIN")) return jsonError("Forbidden", 403);

  const { slug } = await ctx.params;
  const def = await prisma.agentDefinition.findUnique({ where: { slug } });
  if (!def) return jsonError("Unknown agent", 404);

  const body = await req.json().catch(() => ({}));
  const enabled = typeof body.enabled === "boolean" ? body.enabled : undefined;
  const config = body.config && typeof body.config === "object" ? body.config : undefined;

  const existing = await prisma.agentConfig.findUnique({
    where: { agentId_tenantId: { agentId: def.id, tenantId } },
  });
  const mergedConfig = config
    ? { ...(existing ? safeParse(existing.config) ?? {} : {}), ...config }
    : existing
      ? safeParse(existing.config) ?? {}
      : {};

  const row = await prisma.agentConfig.upsert({
    where: { agentId_tenantId: { agentId: def.id, tenantId } },
    create: {
      agentId: def.id, tenantId,
      enabled: enabled ?? true,
      config: JSON.stringify(mergedConfig),
    },
    update: {
      enabled: enabled ?? undefined,
      config: JSON.stringify(mergedConfig),
    },
  });

  logAudit({
    session, action: "agent.config_updated", entity: "AgentConfig",
    entityId: row.id, tenantId, meta: { slug, enabled, configKeys: config ? Object.keys(config) : [] },
  });

  return NextResponse.json({
    agent: { slug: def.slug, name: def.name },
    enabled: row.enabled,
    config: safeParse(row.config),
  });
}

function safeParse(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s); } catch { return null; }
}
