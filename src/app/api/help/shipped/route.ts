import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail, assertEffectiveRoleOrFail } from "@/lib/api-utils";
import { listShippedSlugIndex } from "@/lib/help";

/**
 * GET /api/help/shipped — canonical index of every shipped article (English
 * titles + categories). Used by the override editor to show a complete list
 * regardless of which articles a tenant has overridden.
 */
export async function GET(_req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const forbidden = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (forbidden) return forbidden;

  const index = await listShippedSlugIndex();
  return NextResponse.json(index);
}
