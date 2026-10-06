import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { assertPermissionOrFail, Permission } from "@/lib/permissions";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { checkCharityGate } from "@/lib/charity/feature-gate";
import { charityGateError } from "@/lib/charity/api-helpers";
import type { CharityAssetLiabilityKind } from "@prisma/client";

const ALLOWED_KINDS: CharityAssetLiabilityKind[] = [
  "CASH_AT_BANK",
  "INVESTMENT",
  "FIXED_ASSET",
  "DEBTOR",
  "CREDITOR",
  "STOCK",
  "OTHER_ASSET",
  "OTHER_LIABILITY",
];

/** GET /api/charity/asset-liabilities?yearId=... */
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

  const rows = await prisma.charityAssetLiability.findMany({
    where: { tenantId, financialYearId: yearId },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(rows);
}

/** POST — create an asset/liability line. Year-lock applies. */
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

  let body: {
    financialYearId?: string;
    kind?: CharityAssetLiabilityKind;
    name?: string;
    amount?: number;
    notes?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  if (!body.financialYearId) return jsonError("financialYearId required");
  if (!body.kind || !ALLOWED_KINDS.includes(body.kind)) {
    return jsonError(`kind must be one of ${ALLOWED_KINDS.join(", ")}`);
  }
  if (!body.name) return jsonError("name required");
  if (typeof body.amount !== "number" || !Number.isInteger(body.amount) || body.amount < 0) {
    return jsonError("amount must be a non-negative integer (pence)");
  }

  const year = await prisma.charityFinancialYear.findFirst({
    where: { id: body.financialYearId, tenantId },
  });
  if (!year) return jsonError("financialYearId not found", 404);
  if (year.status === "LOCKED") return jsonError("Year is locked", 409);

  const row = await prisma.charityAssetLiability.create({
    data: {
      tenantId,
      financialYearId: year.id,
      kind: body.kind,
      name: body.name,
      amount: body.amount,
      notes: body.notes ?? null,
    },
  });
  logAudit({
    session,
    action: "charity.asset_liability.created",
    entity: "CharityAssetLiability",
    entityId: row.id,
    tenantId,
    meta: { kind: row.kind, amount: row.amount },
  });
  return NextResponse.json(row, { status: 201 });
}
