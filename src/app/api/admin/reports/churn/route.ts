import { NextResponse } from "next/server";
import { getSessionOrFail, assertRoleOrFail, rejectIfImpersonating } from "@/lib/api-utils";
import { getChurnReport } from "@/lib/billing";

/**
 * GET /api/admin/reports/churn
 *
 * Returns churn metrics: total churned, churn rate, monthly trend,
 * and individual churned tenants. PLATFORM_ADMIN only.
 */
export async function GET() {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const report = await getChurnReport();
  return NextResponse.json(report);
}
