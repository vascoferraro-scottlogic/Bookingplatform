import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";

/**
 * GET /api/federations/[id] — federation detail with member clubs.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;
  const { tenantId, error: tErr } = resolveTenantId(session);
  if (tErr) return tErr;

  if (!(await isFeatureEnabled(tenantId, "federation"))) {
    return jsonError("Federation feature is not enabled", 403);
  }

  // Caller must be a member of this federation
  const myMembership = await prisma.federationMembership.findFirst({
    where: { federationId: id, tenantId, leftAt: null },
  });
  if (!myMembership) return jsonError("Federation not found", 404);

  const federation = await prisma.federation.findUnique({
    where: { id },
    include: {
      memberships: {
        where: { leftAt: null },
        include: {
          tenant: { select: { id: true, name: true, slug: true, locality: true } },
        },
        orderBy: { joinedAt: "asc" },
      },
      invites: {
        where: { status: "PENDING" },
        include: {
          inviteeTenant: { select: { id: true, name: true, slug: true, locality: true } },
          inviterTenant: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!federation) return jsonError("Federation not found", 404);

  return NextResponse.json(federation);
}
