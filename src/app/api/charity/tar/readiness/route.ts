import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { assertPermissionOrFail, Permission } from "@/lib/permissions";
import { resolveTenantId } from "@/lib/tenant";
import { checkCharityGate } from "@/lib/charity/feature-gate";
import { charityGateError } from "@/lib/charity/api-helpers";

type Warning = { key: string; message: string };

/**
 * GET /api/charity/tar/readiness?yearId=...
 *
 * Returns soft warnings about missing data that would make the TAR
 * less useful. These are advisory — they don't block the wizard.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  const permErr = await assertPermissionOrFail(session, tenantId, Permission.charity_view);
  if (permErr) return permErr;
  const gate = await checkCharityGate(tenantId);
  const gateErr = charityGateError(gate);
  if (gateErr) return gateErr;

  const url = new URL(req.url);
  const yearId = url.searchParams.get("yearId");
  if (!yearId) return jsonError("yearId required");

  const year = await prisma.charityFinancialYear.findFirst({
    where: { id: yearId, tenantId },
  });
  if (!year) return jsonError("yearId not found", 404);

  const warnings: Warning[] = [];

  // Check in parallel
  const [txnCount, settings, trusteeCount] = await Promise.all([
    prisma.charityTransaction.count({
      where: { tenantId, financialYearId: yearId },
    }),
    prisma.charitySettings.findUnique({
      where: { tenantId },
      select: { charityNumber: true },
    }),
    prisma.membership.count({
      where: { tenantId, status: "ACTIVE", role: "TENANT_ADMIN" },
    }),
  ]);

  if (txnCount === 0) {
    warnings.push({
      key: "no_transactions",
      message:
        "No transactions recorded for this year. The financial review section will have limited data.",
    });
  }

  if (!settings?.charityNumber?.trim()) {
    warnings.push({
      key: "no_charity_number",
      message:
        "Charity registration number not set. Update it in Charity Settings before finalising.",
    });
  }

  if (trusteeCount === 0) {
    warnings.push({
      key: "no_trustees",
      message:
        "No trustees found (tenant admin members). The reference & admin section needs trustee names.",
    });
  }

  // Year not ended yet (ISO string compare works for YYYY-MM-DD)
  const today = new Date().toISOString().slice(0, 10);
  if (year.endDate > today) {
    warnings.push({
      key: "year_not_ended",
      message:
        `This financial year doesn't end until ${year.endDate}. You can start drafting but data will be incomplete.`,
    });
  }

  return NextResponse.json({ warnings });
}
