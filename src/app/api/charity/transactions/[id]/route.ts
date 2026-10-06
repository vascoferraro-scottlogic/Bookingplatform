import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { assertPermissionOrFail, Permission } from "@/lib/permissions";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { checkCharityGate } from "@/lib/charity/feature-gate";
import { charityGateError } from "@/lib/charity/api-helpers";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function loadOrFail(id: string, tenantId: string) {
  const txn = await prisma.charityTransaction.findFirst({
    where: { id, tenantId },
    include: { financialYear: true },
  });
  return txn;
}

/** PATCH — edit fields. Rejects edits when the year is LOCKED. */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  const permErr = await assertPermissionOrFail(session, tenantId, Permission.charity_edit);
  if (permErr) return permErr;
  const gate = await checkCharityGate(tenantId);
  const gateErr = charityGateError(gate);
  if (gateErr) return gateErr;

  const txn = await loadOrFail(id, tenantId);
  if (!txn) return jsonError("Not found", 404);
  if (txn.financialYear.status === "LOCKED") {
    return jsonError("Year is locked", 409);
  }

  let body: {
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

  const data: Partial<{
    date: string;
    amount: number;
    categoryId: string;
    kind: "RECEIPT" | "PAYMENT";
    fundId: string;
    description: string;
    reference: string | null;
  }> = {};

  if (body.date !== undefined) {
    if (!ISO_DATE.test(body.date)) return jsonError("date must be YYYY-MM-DD");
    if (body.date < txn.financialYear.startDate || body.date > txn.financialYear.endDate) {
      return jsonError(
        `date must fall within ${txn.financialYear.startDate} → ${txn.financialYear.endDate}`,
      );
    }
    data.date = body.date;
  }
  if (body.amount !== undefined) {
    if (!Number.isInteger(body.amount) || body.amount <= 0) {
      return jsonError("amount must be a positive integer (pence)");
    }
    data.amount = body.amount;
  }
  if (body.categoryId !== undefined) {
    const cat = await prisma.charityCategory.findFirst({
      where: { id: body.categoryId, tenantId },
    });
    if (!cat) return jsonError("categoryId not found", 404);
    data.categoryId = cat.id;
    data.kind = cat.kind;
  }
  if (body.fundId !== undefined) {
    const fund = await prisma.charityFund.findFirst({
      where: { id: body.fundId, tenantId },
    });
    if (!fund) return jsonError("fundId not found", 404);
    data.fundId = fund.id;
  }
  if (body.description !== undefined) {
    if (!body.description) return jsonError("description required");
    data.description = body.description;
  }
  if (body.reference !== undefined) {
    data.reference = body.reference;
  }

  const updated = await prisma.charityTransaction.update({ where: { id }, data });
  logAudit({
    session,
    action: "charity.transaction.updated",
    entity: "CharityTransaction",
    entityId: id,
    tenantId,
    meta: { fields: Object.keys(data) },
  });
  return NextResponse.json(updated);
}

/** DELETE — remove. Rejects when the year is LOCKED. */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  const permErr2 = await assertPermissionOrFail(session, tenantId, Permission.charity_edit);
  if (permErr2) return permErr2;
  const gate = await checkCharityGate(tenantId);
  const gateErr = charityGateError(gate);
  if (gateErr) return gateErr;

  const txn = await loadOrFail(id, tenantId);
  if (!txn) return jsonError("Not found", 404);
  if (txn.financialYear.status === "LOCKED") {
    return jsonError("Year is locked", 409);
  }

  await prisma.charityTransaction.delete({ where: { id } });
  logAudit({
    session,
    action: "charity.transaction.deleted",
    entity: "CharityTransaction",
    entityId: id,
    tenantId,
  });
  return NextResponse.json({ deleted: true });
}
