import { NextRequest, NextResponse } from "next/server";
import {
  getSessionOrFail,
  jsonError,
  assertEffectiveRoleOrFail,
} from "@/lib/api-utils";
import { getEffectiveRole } from "@/lib/roles";
import { isFeatureEnabled } from "@/lib/features";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

/**
 * Per-tenant help article overrides.
 *
 * Gated behind the `helpOverrides` feature flag (off by default). Tenant admins
 * can list, create, update or delete overrides for their own tenant. Platform
 * admins must impersonate a tenant before they can mutate overrides — this is
 * the same convention used by other tenant-plane endpoints.
 */

async function requireHelpOverridesFlag(tenantId: string): Promise<NextResponse | null> {
  const enabled = await isFeatureEnabled(tenantId, "helpOverrides");
  if (!enabled) {
    return NextResponse.json(
      { error: "FEATURE_DISABLED", message: "Help overrides are not enabled for this tenant." },
      { status: 403 },
    );
  }
  return null;
}

export async function GET(_req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const forbidden = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (forbidden) return forbidden;

  const eff = getEffectiveRole(session.user);
  const tenantId = eff.tenantId!;
  const flagBlock = await requireHelpOverridesFlag(tenantId);
  if (flagBlock) return flagBlock;

  const rows = await prisma.helpArticleOverride.findMany({
    where: { tenantId },
    orderBy: [{ slug: "asc" }, { locale: "asc" }],
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const forbidden = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (forbidden) return forbidden;

  const eff = getEffectiveRole(session.user);
  const tenantId = eff.tenantId!;
  const flagBlock = await requireHelpOverridesFlag(tenantId);
  if (flagBlock) return flagBlock;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.slug !== "string" || typeof body.locale !== "string") {
    return jsonError("Provide slug and locale", 400);
  }

  const data = {
    tenantId,
    slug: body.slug,
    locale: body.locale,
    enabled: body.enabled !== false,
    title: typeof body.title === "string" ? body.title : null,
    body: typeof body.body === "string" ? body.body : null,
    createdById: session.user.id,
    updatedById: session.user.id,
  };

  const row = await prisma.helpArticleOverride.upsert({
    where: { tenantId_slug_locale: { tenantId, slug: body.slug, locale: body.locale } },
    update: {
      enabled: data.enabled,
      title: data.title,
      body: data.body,
      updatedById: session.user.id,
    },
    create: data,
  });

  logAudit({
    session,
    action: "help.override.upserted",
    entity: "HelpArticleOverride",
    entityId: row.id,
    meta: { slug: row.slug, locale: row.locale, enabled: row.enabled },
  });

  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const forbidden = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (forbidden) return forbidden;

  const eff = getEffectiveRole(session.user);
  const tenantId = eff.tenantId!;
  const flagBlock = await requireHelpOverridesFlag(tenantId);
  if (flagBlock) return flagBlock;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return jsonError("Provide id", 400);

  // Limit deletion to overrides owned by the current tenant.
  const existing = await prisma.helpArticleOverride.findUnique({ where: { id } });
  if (!existing || existing.tenantId !== tenantId) return jsonError("Not found", 404);

  await prisma.helpArticleOverride.delete({ where: { id } });

  logAudit({
    session,
    action: "help.override.deleted",
    entity: "HelpArticleOverride",
    entityId: id,
    meta: { slug: existing.slug, locale: existing.locale },
  });

  return NextResponse.json({ ok: true });
}
