import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { assertPermissionOrFail, Permission } from "@/lib/permissions";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { checkCharityGate } from "@/lib/charity/feature-gate";
import { charityGateError } from "@/lib/charity/api-helpers";

// ISO date YYYY-MM-DD; lenient — DB stores as text.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** GET — list financial years for the tenant (newest first). */
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

  const years = await prisma.charityFinancialYear.findMany({
    where: { tenantId },
    orderBy: { startDate: "desc" },
  });
  return NextResponse.json(years);
}

/** POST — create a new financial year. */
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  const permErr2 = await assertPermissionOrFail(session, tenantId, Permission.charity_edit);
  if (permErr2) return permErr2;
  const gate = await checkCharityGate(tenantId);
  const gateErr = charityGateError(gate);
  if (gateErr) return gateErr;

  let body: { startDate?: string; endDate?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  if (!body.startDate || !ISO_DATE.test(body.startDate)) {
    return jsonError("startDate must be YYYY-MM-DD");
  }
  if (!body.endDate || !ISO_DATE.test(body.endDate)) {
    return jsonError("endDate must be YYYY-MM-DD");
  }
  if (body.endDate <= body.startDate) {
    return jsonError("endDate must be after startDate");
  }

  // Reject overlap with an existing year (same tenant). Cheap O(N) scan;
  // there are typically <10 years per tenant.
  const existing = await prisma.charityFinancialYear.findMany({ where: { tenantId } });
  for (const y of existing) {
    if (body.startDate <= y.endDate && body.endDate >= y.startDate) {
      return jsonError(
        `Overlaps existing year ${y.startDate} → ${y.endDate}`,
        409,
      );
    }
  }

  const year = await prisma.charityFinancialYear.create({
    data: { tenantId, startDate: body.startDate, endDate: body.endDate },
  });
  logAudit({
    session,
    action: "charity.year.created",
    entity: "CharityFinancialYear",
    entityId: year.id,
    tenantId,
    meta: { startDate: year.startDate, endDate: year.endDate },
  });
  return NextResponse.json(year, { status: 201 });
}
