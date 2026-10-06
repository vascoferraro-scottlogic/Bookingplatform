import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { getEffectiveRole } from "@/lib/roles";
import { getArticle } from "@/lib/help";

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

  const article = await getArticle({
    slug,
    locale,
    tenantId: eff.tenantId ?? session.user.tenantId ?? undefined,
    realRole,
  });
  if (!article) return jsonError("Not found", 404);
  return NextResponse.json(article);
}
