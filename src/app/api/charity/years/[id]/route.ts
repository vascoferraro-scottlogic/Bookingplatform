import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { assertPermissionOrFail, Permission } from "@/lib/permissions";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { checkCharityGate } from "@/lib/charity/feature-gate";
import { charityGateError } from "@/lib/charity/api-helpers";

/** PATCH — update bankBalanceAtEnd or lock the year. */
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

  const year = await prisma.charityFinancialYear.findFirst({
    where: { id, tenantId },
  });
  if (!year) return jsonError("Not found", 404);

  let body: { bankBalanceAtEnd?: number | null; lock?: boolean; unlock?: boolean };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  const data: {
    bankBalanceAtEnd?: number | null;
    status?: "OPEN" | "LOCKED";
    lockedAt?: Date | null;
    lockedById?: string | null;
  } = {};

  if (body.bankBalanceAtEnd !== undefined) {
    if (
      body.bankBalanceAtEnd !== null &&
      (typeof body.bankBalanceAtEnd !== "number" || !Number.isInteger(body.bankBalanceAtEnd))
    ) {
      return jsonError("bankBalanceAtEnd must be integer pence or null");
    }
    if (year.status === "LOCKED") {
      return jsonError("Year is locked", 409);
    }
    data.bankBalanceAtEnd = body.bankBalanceAtEnd;
  }

  if (body.lock === true) {
    if (year.status === "LOCKED") return jsonError("Already locked", 409);
    data.status = "LOCKED";
    data.lockedAt = new Date();
    data.lockedById = session.user.id;
  } else if (body.unlock === true) {
    if (year.status !== "LOCKED") return jsonError("Not locked", 409);
    data.status = "OPEN";
    data.lockedAt = null;
    data.lockedById = null;
  }

  // Unlock: also revert any finalised TAR to DRAFT in the same transaction
  if (body.unlock === true) {
    const [updated] = await prisma.$transaction([
      prisma.charityFinancialYear.update({ where: { id }, data }),
      prisma.charityTAR.updateMany({
        where: { tenantId, financialYearId: id, status: "FINALISED" },
        data: { status: "DRAFT", finalisedAt: null, finalisedById: null },
      }),
    ]);
    logAudit({
      session,
      action: "charity.year.unlocked",
      entity: "CharityFinancialYear",
      entityId: id,
      tenantId,
    });
    logAudit({
      session,
      action: "charity.tar.reopened",
      entity: "CharityTAR",
      entityId: id,
      tenantId,
    });
    return NextResponse.json(updated);
  }

  const updated = await prisma.charityFinancialYear.update({
    where: { id },
    data,
  });

  if (body.lock) {
    logAudit({
      session,
      action: "charity.year.locked",
      entity: "CharityFinancialYear",
      entityId: id,
      tenantId,
    });
  } else {
    logAudit({
      session,
      action: "charity.year.updated",
      entity: "CharityFinancialYear",
      entityId: id,
      tenantId,
      meta: { bankBalanceAtEnd: data.bankBalanceAtEnd },
    });
  }

  return NextResponse.json(updated);
}
