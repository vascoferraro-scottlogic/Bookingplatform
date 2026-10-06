import { NextRequest, NextResponse } from "next/server";
import { KnowledgeScope } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, jsonError, rejectIfImpersonating } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { hasRole } from "@/lib/roles";
import { logAudit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/agent/knowledge/[id] — update an entry.
 * DELETE /api/agent/knowledge/[id] — delete an entry.
 *
 * Authorisation mirrors the POST in ../route.ts:
 * - GLOBAL/REGIONAL → PLATFORM_ADMIN.
 * - TENANT          → TENANT_ADMIN+ for the owning tenant.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { id } = await ctx.params;
  const entry = await prisma.agentKnowledge.findUnique({ where: { id } });
  if (!entry) return jsonError("Not found", 404);

  const authErr = await assertCanMutate(req, session, entry.scope, entry.tenantId);
  if (authErr) return authErr;

  const body = await req.json().catch(() => ({}));
  const updated = await prisma.agentKnowledge.update({
    where: { id },
    data: {
      title: typeof body.title === "string" ? body.title.trim() : undefined,
      content: typeof body.content === "string" ? body.content.trim() : undefined,
      category: typeof body.category === "string" ? body.category.trim() : undefined,
      priority: typeof body.priority === "number" ? body.priority : undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
      region: typeof body.region === "string" ? body.region : undefined,
    },
  });

  logAudit({
    session, action: "agent.knowledge_updated", entity: "AgentKnowledge",
    entityId: id, tenantId: entry.tenantId ?? undefined,
    meta: { fields: Object.keys(body) },
  });

  return NextResponse.json({ entry: updated });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { id } = await ctx.params;
  const entry = await prisma.agentKnowledge.findUnique({ where: { id } });
  if (!entry) return jsonError("Not found", 404);

  const authErr = await assertCanMutate(req, session, entry.scope, entry.tenantId);
  if (authErr) return authErr;

  await prisma.agentKnowledge.delete({ where: { id } });
  logAudit({
    session, action: "agent.knowledge_deleted", entity: "AgentKnowledge",
    entityId: id, tenantId: entry.tenantId ?? undefined,
  });
  return NextResponse.json({ ok: true });
}

async function assertCanMutate(
  req: NextRequest,
  session: Awaited<ReturnType<typeof getSessionOrFail>>["session"] & {},
  scope: KnowledgeScope,
  entryTenantId: string | null,
): Promise<NextResponse | null> {
  if (scope === KnowledgeScope.GLOBAL || scope === KnowledgeScope.REGIONAL) {
    // Platform-plane: requires a real, non-impersonating PLATFORM_ADMIN.
    if (session.user.role !== "PLATFORM_ADMIN") {
      return jsonError("PLATFORM_ADMIN required", 403);
    }
    const impErr = rejectIfImpersonating(session);
    if (impErr) return impErr;
    return null;
  }
  if (!hasRole(getEffective(session).role, "TENANT_ADMIN")) return jsonError("Forbidden", 403);
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  if (tenantId !== entryTenantId) return jsonError("Forbidden", 403);
  return null;
}
