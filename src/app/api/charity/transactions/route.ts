import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { assertPermissionOrFail, Permission } from "@/lib/permissions";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { checkCharityGate } from "@/lib/charity/feature-gate";
import { charityGateError } from "@/lib/charity/api-helpers";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/charity/transactions?yearId=...&categoryId=...&fundId=...
 * All filters optional; yearId strongly recommended (ledger UI passes it).
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
  const categoryId = url.searchParams.get("categoryId");
  const fundId = url.searchParams.get("fundId");

  const txns = await prisma.charityTransaction.findMany({
    where: {
      tenantId,
      ...(yearId ? { financialYearId: yearId } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(fundId ? { fundId } : {}),
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: {
      category: { select: { id: true, code: true, label: true, kind: true } },
      fund: { select: { id: true, name: true, kind: true } },
    },
  });
  return NextResponse.json(txns);
}

/** POST — create a transaction. Rejects writes to a LOCKED year. */
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
    date?: string;
    amount?: number;
    categoryId?: string;
    fundId?: string;
    description?: string;
    reference?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  if (!body.financialYearId) return jsonError("financialYearId required");
  if (!body.date || !ISO_DATE.test(body.date)) return jsonError("date must be YYYY-MM-DD");
  if (typeof body.amount !== "number" || !Number.isInteger(body.amount) || body.amount <= 0) {
    return jsonError("amount must be a positive integer (pence)");
  }
  if (!body.categoryId) return jsonError("categoryId required");
  if (!body.fundId) return jsonError("fundId required");
  if (!body.description || typeof body.description !== "string") {
    return jsonError("description required");
  }

  // Tenant-scope all FK lookups in parallel.
  const [year, category, fund] = await Promise.all([
    prisma.charityFinancialYear.findFirst({ where: { id: body.financialYearId, tenantId } }),
    prisma.charityCategory.findFirst({ where: { id: body.categoryId, tenantId } }),
    prisma.charityFund.findFirst({ where: { id: body.fundId, tenantId } }),
  ]);
  if (!year) return jsonError("financialYearId not found", 404);
  if (!category) return jsonError("categoryId not found", 404);
  if (!fund) return jsonError("fundId not found", 404);
  if (year.status === "LOCKED") {
    return jsonError("Year is locked", 409);
  }
  if (body.date < year.startDate || body.date > year.endDate) {
    return jsonError(
      `date must fall within ${year.startDate} → ${year.endDate}`,
    );
  }

  const txn = await prisma.charityTransaction.create({
    data: {
      tenantId,
      financialYearId: year.id,
      date: body.date,
      amount: body.amount,
      kind: category.kind,
      categoryId: category.id,
      fundId: fund.id,
      description: body.description,
      reference: body.reference ?? null,
      source: "MANUAL",
      createdById: session.user.id,
    },
    include: {
      category: { select: { id: true, code: true, label: true, kind: true } },
      fund: { select: { id: true, name: true, kind: true } },
    },
  });
  logAudit({
    session,
    action: "charity.transaction.created",
    entity: "CharityTransaction",
    entityId: txn.id,
    tenantId,
    meta: {
      yearId: year.id,
      amount: body.amount,
      kind: category.kind,
      categoryCode: category.code,
      fundName: fund.name,
    },
  });
  return NextResponse.json(txn, { status: 201 });
}
