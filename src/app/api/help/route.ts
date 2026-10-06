import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { getEffectiveRole } from "@/lib/roles";
import { listArticles } from "@/lib/help";

/**
 * GET /api/help — list help articles, filtered by audience and (optionally)
 * category and search query. Locale is taken from `?locale=` or falls back
 * to the session/tenant locale (defaulting to "en" — locale resolution will
 * be wired through on the UI side using the existing useTranslation hook).
 *
 * Visible to TENANT_ADMIN (effective role) and PLATFORM_ADMIN.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const eff = getEffectiveRole(session.user);
  const realRole = session.user.role;
  const isAllowed =
    realRole === "PLATFORM_ADMIN" || eff.role === "TENANT_ADMIN";
  if (!isAllowed) return jsonError("Forbidden", 403);

  const sp = req.nextUrl.searchParams;
  const locale = sp.get("locale") || "en";
  const category = sp.get("category") || undefined;
  const query = sp.get("q") || undefined;

  const articles = await listArticles({
    locale,
    tenantId: eff.tenantId ?? session.user.tenantId ?? undefined,
    realRole,
    category,
    query,
  });
  return NextResponse.json(articles);
}
