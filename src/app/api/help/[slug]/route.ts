import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { getEffectiveRole } from "@/lib/roles";
import { getArticle } from "@/lib/help";
import { isFeatureEnabled } from "@/lib/features";

/** GET /api/help/[slug] — single article (markdown body + metadata). */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const eff = getEffectiveRole(session.user);
  const realRole = session.user.role;
  const isAllowed =
    realRole === "PLATFORM_ADMIN" || eff.role === "TENANT_ADMIN";
  if (!isAllowed) return jsonError("Forbidden", 403);

  const { slug } = await context.params;
  const locale = req.nextUrl.searchParams.get("locale") || "en";

  // Overrides only apply while the helpOverrides flag is on for the tenant.
  const tenantId = eff.tenantId ?? session.user.tenantId ?? undefined;
  const overridesOn = tenantId ? await isFeatureEnabled(tenantId, "helpOverrides") : false;

  const article = await getArticle({
    slug,
    locale,
    tenantId: overridesOn ? tenantId : undefined,
    realRole,
  });
  if (!article) return jsonError("Not found", 404);
  return NextResponse.json(article);
}
