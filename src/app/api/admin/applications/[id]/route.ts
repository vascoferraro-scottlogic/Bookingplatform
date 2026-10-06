import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  assertRoleOrFail,
  rejectIfImpersonating,
  jsonError,
} from "@/lib/api-utils";

type Params = { params: Promise<{ id: string }> };

/** GET single application detail. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const { id } = await params;
  const app = await prisma.tenantApplication.findUnique({
    where: { id },
    include: { tenant: { select: { id: true, name: true, slug: true, status: true } } },
  });
  if (!app) return jsonError("Application not found", 404);
  return NextResponse.json(app);
}
