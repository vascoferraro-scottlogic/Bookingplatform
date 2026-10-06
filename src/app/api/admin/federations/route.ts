import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertRoleOrFail, rejectIfImpersonating } from "@/lib/api-utils";

/**
 * GET /api/admin/federations — list all federations (PLATFORM_ADMIN only).
 */
export async function GET() {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const federations = await prisma.federation.findMany({
    include: {
      createdByTenant: { select: { id: true, name: true, slug: true } },
      _count: { select: { memberships: { where: { leftAt: null } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    federations.map((f) => ({
      ...f,
      memberCount: f._count.memberships,
    })),
  );
}
