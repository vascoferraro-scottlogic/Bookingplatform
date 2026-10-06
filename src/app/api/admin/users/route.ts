import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, getEffective } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";

/** List users scoped to the caller's effective tenant context. */
export async function GET(_req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const tenantId = getEffective(session).tenantId;
  if (!tenantId) return NextResponse.json([]);

  const users = await prisma.user.findMany({
    where: { tenantId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      suspended: true,
      createdAt: true,
      _count: { select: { bookings: true, submittedTasks: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  logAudit({ session, action: "pii.user_list_viewed", entity: "User", piiAccess: true, tenantId, meta: { count: users.length } });

  return NextResponse.json(users);
}
