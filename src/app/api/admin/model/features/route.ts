import { NextResponse } from "next/server";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { assertRoleOrFail, rejectIfImpersonating } from "@/lib/api-utils";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/model/features
 *
 * Lists all MlFeatureDefinition rows (enrolled, available, retired).
 */
export async function GET() {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const features = await prisma.mlFeatureDefinition.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json(features);
}
