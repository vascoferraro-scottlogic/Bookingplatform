import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  assertRoleOrFail,
  rejectIfImpersonating,
  jsonError,
} from "@/lib/api-utils";

/**
 * GET /api/admin/applications — list tenant applications.
 * Optional `?status=PENDING` filter. Platform admin only.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const where = status ? { status: status as never } : {};
  const apps = await prisma.tenantApplication.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { tenant: { select: { id: true, name: true, slug: true } } },
  });

  return NextResponse.json(apps);
}
