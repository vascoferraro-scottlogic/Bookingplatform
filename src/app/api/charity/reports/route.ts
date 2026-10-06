import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { assertPermissionOrFail, Permission } from "@/lib/permissions";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { checkCharityGate } from "@/lib/charity/feature-gate";
import { charityGateError } from "@/lib/charity/api-helpers";
import {
  buildReceiptsAndPayments,
  buildStatementOfAssetsAndLiabilities,
  receiptsAndPaymentsToCSV,
} from "@/lib/charity/reports";

/**
 * GET /api/charity/reports?yearId=...&format=json|csv
 * Returns both R&P + SoAL when format=json (default) or just R&P CSV when format=csv.
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
  const format = url.searchParams.get("format") ?? "json";
  if (!yearId) return jsonError("yearId required");

  const year = await prisma.charityFinancialYear.findFirst({
    where: { id: yearId, tenantId },
  });
  if (!year) return jsonError("yearId not found", 404);

  const rp = await buildReceiptsAndPayments(tenantId, yearId);

  if (format === "csv") {
    const csv = receiptsAndPaymentsToCSV(rp);
    logAudit({
      session,
      action: "charity.report.exported",
      entity: "CharityFinancialYear",
      entityId: yearId,
      tenantId,
      meta: { format: "csv" },
    });
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="rp-${year.startDate}-to-${year.endDate}.csv"`,
      },
    });
  }

  const soal = await buildStatementOfAssetsAndLiabilities(tenantId, yearId);
  logAudit({
    session,
    action: "charity.report.viewed",
    entity: "CharityFinancialYear",
    entityId: yearId,
    tenantId,
  });
  return NextResponse.json({ year, receiptsAndPayments: rp, statementOfAssetsAndLiabilities: soal });
}
