import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { assertPermissionOrFail, Permission } from "@/lib/permissions";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { checkCharityGate } from "@/lib/charity/feature-gate";
import { charityGateError } from "@/lib/charity/api-helpers";

/** GET — list categories for the tenant (sorted by kind then sortOrder). */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  const permErr = await assertPermissionOrFail(session, tenantId, Permission.charity_edit);
  if (permErr) return permErr;
  const gate = await checkCharityGate(tenantId);
  const gateErr = charityGateError(gate);
  if (gateErr) return gateErr;

  const cats = await prisma.charityCategory.findMany({
    where: { tenantId },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
  });
  return NextResponse.json(cats);
}

/** POST — add a custom category. */
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
    code?: string;
    kind?: "RECEIPT" | "PAYMENT";
    label?: string;
    sortOrder?: number;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  if (!body.code || typeof body.code !== "string") return jsonError("code required");
  if (body.kind !== "RECEIPT" && body.kind !== "PAYMENT") {
    return jsonError("kind must be RECEIPT or PAYMENT");
  }
  if (!body.label || typeof body.label !== "string") return jsonError("label required");

  // Reject duplicate code for this tenant.
  const exists = await prisma.charityCategory.findUnique({
    where: { tenantId_code: { tenantId, code: body.code } },
  });
  if (exists) return jsonError(`code '${body.code}' already exists`, 409);

  const cat = await prisma.charityCategory.create({
    data: {
      tenantId,
      code: body.code,
      kind: body.kind,
      label: body.label,
      sortOrder: body.sortOrder ?? 500,
    },
  });
  logAudit({
    session,
    action: "charity.category.created",
    entity: "CharityCategory",
    entityId: cat.id,
    tenantId,
    meta: { code: cat.code, kind: cat.kind },
  });
  return NextResponse.json(cat, { status: 201 });
}
