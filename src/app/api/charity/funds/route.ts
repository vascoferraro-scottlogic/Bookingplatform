import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { assertPermissionOrFail, Permission } from "@/lib/permissions";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { checkCharityGate } from "@/lib/charity/feature-gate";
import { charityGateError } from "@/lib/charity/api-helpers";
import type { CharityFundKind } from "@prisma/client";

const ALLOWED_KINDS: CharityFundKind[] = ["UNRESTRICTED", "RESTRICTED", "DESIGNATED"];

/** GET — list funds. */
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

  const funds = await prisma.charityFund.findMany({
    where: { tenantId },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(funds);
}

/** POST — create a fund. */
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  const permErr2 = await assertPermissionOrFail(session, tenantId, Permission.charity_manage_funds);
  if (permErr2) return permErr2;
  const gate = await checkCharityGate(tenantId);
  const gateErr = charityGateError(gate);
  if (gateErr) return gateErr;

  let body: { name?: string; kind?: CharityFundKind };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  if (!body.name || typeof body.name !== "string") return jsonError("name required");
  if (!body.kind || !ALLOWED_KINDS.includes(body.kind)) {
    return jsonError(`kind must be one of ${ALLOWED_KINDS.join(", ")}`);
  }

  const exists = await prisma.charityFund.findUnique({
    where: { tenantId_name: { tenantId, name: body.name } },
  });
  if (exists) return jsonError(`fund '${body.name}' already exists`, 409);

  const fund = await prisma.charityFund.create({
    data: { tenantId, name: body.name, kind: body.kind },
  });
  logAudit({
    session,
    action: "charity.fund.created",
    entity: "CharityFund",
    entityId: fund.id,
    tenantId,
    meta: { name: fund.name, kind: fund.kind },
  });
  return NextResponse.json(fund, { status: 201 });
}
