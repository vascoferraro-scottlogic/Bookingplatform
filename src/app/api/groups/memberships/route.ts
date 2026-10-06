import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";

/**
 * GET /api/groups/memberships — list all active memberships for the tenant.
 * Used by the groups UI to populate the "add member" dropdown.
 */
export async function GET() {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;
  const { tenantId, error: tErr } = resolveTenantId(session);
  if (tErr) return tErr;

  const memberships = await prisma.membership.findMany({
    where: { tenantId, status: "ACTIVE" },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { user: { name: "asc" } },
  });

  return NextResponse.json(memberships);
}
