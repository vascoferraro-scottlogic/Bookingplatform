import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";

const MAX_FEDERATIONS_PER_CLUB = 3;

/**
 * GET /api/federations — list federations the current tenant belongs to.
 */
export async function GET() {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;
  const { tenantId, error: tErr } = resolveTenantId(session);
  if (tErr) return tErr;

  if (!(await isFeatureEnabled(tenantId, "federation"))) {
    return NextResponse.json([]);
  }

  const memberships = await prisma.federationMembership.findMany({
    where: { tenantId, leftAt: null },
    include: {
      federation: {
        include: {
          _count: { select: { memberships: { where: { leftAt: null } } } },
        },
      },
    },
    orderBy: { joinedAt: "desc" },
  });

  return NextResponse.json(
    memberships.map((m) => ({
      ...m.federation,
      billingMode: m.billingMode,
      memberCount: m.federation._count.memberships,
    })),
  );
}

/**
 * POST /api/federations — create a new federation.
 * Body: { name: string, description?: string }
 *
 * The creating club automatically becomes the first member.
 */
export async function POST(req: Request) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;
  const { tenantId, error: tErr } = resolveTenantId(session);
  if (tErr) return tErr;

  if (!(await isFeatureEnabled(tenantId, "federation"))) {
    return jsonError("Federation feature is not enabled", 403);
  }

  const body = await req.json();
  const name = (body.name ?? "").trim();
  if (!name) return jsonError("Name is required", 400);

  // Check federation name uniqueness
  const existing = await prisma.federation.findUnique({ where: { name } });
  if (existing) return jsonError("A federation with that name already exists", 409);

  // Check max federations per club
  const currentCount = await prisma.federationMembership.count({
    where: { tenantId, leftAt: null },
  });
  if (currentCount >= MAX_FEDERATIONS_PER_CLUB) {
    return jsonError(`A club can belong to at most ${MAX_FEDERATIONS_PER_CLUB} federations`, 400);
  }

  // Create federation + auto-join
  const federation = await prisma.federation.create({
    data: {
      name,
      description: body.description ?? null,
      createdByTenantId: tenantId,
      memberships: {
        create: { tenantId, billingMode: "HOST_CLUB_RATE" },
      },
    },
    include: {
      _count: { select: { memberships: { where: { leftAt: null } } } },
    },
  });

  return NextResponse.json(federation, { status: 201 });
}
