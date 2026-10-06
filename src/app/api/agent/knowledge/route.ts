import { NextRequest, NextResponse } from "next/server";
import { KnowledgeScope, KnowledgeSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, jsonError, rejectIfImpersonating } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { hasRole } from "@/lib/roles";
import { logAudit } from "@/lib/audit";

/**
 * Knowledge base CRUD.
 *
 * GET  /api/agent/knowledge — list entries. Filters: ?scope=&category=&agentSlug=&region=&active=
 *   - PLATFORM_ADMIN: sees everything.
 *   - TENANT_ADMIN+: sees GLOBAL + REGIONAL (matching their region) + their own TENANT entries.
 * POST /api/agent/knowledge — create.
 *   - GLOBAL/REGIONAL → PLATFORM_ADMIN only.
 *   - TENANT → TENANT_ADMIN+ for that tenant.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const eff = getEffective(session);
  if (!hasRole(eff.role, "TENANT_ADMIN")) return jsonError("Forbidden", 403);

  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope") as KnowledgeScope | null;
  const category = searchParams.get("category");
  const agentSlug = searchParams.get("agentSlug");
  const region = searchParams.get("region");
  const activeParam = searchParams.get("active");

  const where: Record<string, unknown> = {};
  if (category) where.category = category;
  if (region) where.region = region;
  if (activeParam !== null) where.active = activeParam === "true";

  if (agentSlug) {
    const def = await prisma.agentDefinition.findUnique({ where: { slug: agentSlug } });
    if (!def) return NextResponse.json({ entries: [] });
    where.OR = [{ agentId: def.id }, { agentId: null }];
  }

  // Visibility scoping uses effective context, not real role. A platform
  // admin who is currently impersonating a tenant should see exactly what
  // that tenant admin would see — not the platform-wide view.
  const isPlatformPlane = session.user.role === "PLATFORM_ADMIN" && !session.user.actingAs;
  if (!isPlatformPlane) {
    const { tenantId } = resolveTenantId(session, req);
    if (!tenantId) return jsonError("Tenant context required", 400);
    const tenantWhere = scope
      ? scope === KnowledgeScope.TENANT
        ? { scope: KnowledgeScope.TENANT, tenantId }
        : { scope }
      : { OR: [
          { scope: KnowledgeScope.GLOBAL },
          { scope: KnowledgeScope.REGIONAL },
          { scope: KnowledgeScope.TENANT, tenantId },
        ] };
    Object.assign(where, tenantWhere);
  } else if (scope) {
    where.scope = scope;
  }

  const entries = await prisma.agentKnowledge.findMany({
    where,
    orderBy: [{ scope: "asc" }, { category: "asc" }, { priority: "desc" }],
    take: 500,
    include: {
      agent: { select: { slug: true, name: true } },
      tenant: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ entries });
}

export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const body = await req.json().catch(() => ({}));

  const scope = body.scope as KnowledgeScope | undefined;
  if (!scope || !Object.values(KnowledgeScope).includes(scope)) {
    return jsonError("Valid scope required", 400);
  }
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!category || !title || !content) return jsonError("category, title and content required", 400);

  let tenantId: string | null = null;
  if (scope === KnowledgeScope.GLOBAL || scope === KnowledgeScope.REGIONAL) {
    // Platform-plane operation: requires a real, non-impersonating PLATFORM_ADMIN.
    // An impersonating platform admin is acting AS a tenant and must not edit
    // platform-wide knowledge whilst in that context.
    if (session.user.role !== "PLATFORM_ADMIN") {
      return jsonError("PLATFORM_ADMIN required for GLOBAL/REGIONAL knowledge", 403);
    }
    const impErr = rejectIfImpersonating(session);
    if (impErr) return impErr;
  } else {
    if (!hasRole(getEffective(session).role, "TENANT_ADMIN")) return jsonError("Forbidden", 403);
    const { tenantId: tid, error: tErr } = resolveTenantId(session, req);
    if (tErr) return tErr;
    tenantId = tid;
  }

  let agentId: string | null = null;
  if (body.agentSlug) {
    const def = await prisma.agentDefinition.findUnique({ where: { slug: body.agentSlug } });
    if (!def) return jsonError("Unknown agent", 400);
    agentId = def.id;
  }

  const entry = await prisma.agentKnowledge.create({
    data: {
      scope,
      tenantId,
      agentId,
      region: typeof body.region === "string" ? body.region : null,
      category,
      title,
      content,
      priority: typeof body.priority === "number" ? body.priority : 0,
      active: body.active !== false,
      source: body.source && Object.values(KnowledgeSource).includes(body.source)
        ? body.source as KnowledgeSource
        : KnowledgeSource.MANUAL,
      createdById: session.user.id,
    },
  });

  logAudit({
    session, action: "agent.knowledge_created", entity: "AgentKnowledge",
    entityId: entry.id, tenantId: tenantId ?? undefined,
    meta: { scope, category, title },
  });

  return NextResponse.json({ entry }, { status: 201 });
}
