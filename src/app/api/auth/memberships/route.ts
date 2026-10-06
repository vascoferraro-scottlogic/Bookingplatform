import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail } from "@/lib/api-utils";
import { getActiveMembershipsForUser } from "@/lib/memberships";

/** GET /api/auth/memberships — return the caller's active memberships. */
export async function GET(_req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const memberships = await getActiveMembershipsForUser(session.user.id);
  return NextResponse.json(
    memberships.map((m) => ({
      tenantId: m.tenantId,
      tenant: m.tenant,
      role: m.role,
      kind: m.kind,
      status: m.status,
    }))
  );
}
