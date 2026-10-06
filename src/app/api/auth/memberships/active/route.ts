import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { userHasActiveMembershipIn } from "@/lib/memberships";

/**
 * POST /api/auth/memberships/active — guard for tenant-context switching.
 * The actual JWT update happens client-side via
 * `useSession().update({ activeTenantId })`. This endpoint 200s if the
 * caller has an active membership in the requested tenant, 403s otherwise.
 * Body: { tenantId }
 */
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  let body: { tenantId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  const tenantId = body.tenantId?.trim();
  if (!tenantId) return jsonError("tenantId required");

  const ok = await userHasActiveMembershipIn(session.user.id, tenantId);
  if (!ok) return jsonError("No active membership in that tenant", 403);

  return NextResponse.json({ ok: true, tenantId });
}
