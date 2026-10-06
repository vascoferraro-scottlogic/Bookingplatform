import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { assertPermissionOrFail, Permission } from "@/lib/permissions";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { checkCharityGate } from "@/lib/charity/feature-gate";
import { charityGateError } from "@/lib/charity/api-helpers";
import { seedCharityDefaults } from "@/lib/charity/seed";
import type { CharityRegulator } from "@prisma/client";

const ALLOWED_REGULATORS: CharityRegulator[] = ["CC_EW", "OSCR", "CCNI"];

/** GET — fetch charity settings (returns 404 if not yet configured). */
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

  const settings = await prisma.charitySettings.findUnique({ where: { tenantId } });
  if (!settings) {
    return NextResponse.json({ configured: false }, { status: 200 });
  }
  return NextResponse.json({ configured: true, ...settings });
}

/**
 * PUT — upsert charity settings. On first creation, also seeds the chart
 * of accounts for the chosen regulator and ensures a default General fund.
 */
export async function PUT(req: NextRequest) {
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
    charityNumber?: string | null;
    regulator?: string;
    yearEndMonth?: number;
    yearEndDay?: number;
    reservesPolicy?: string | null;
    publicBenefitStatement?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  if (!body.regulator || !ALLOWED_REGULATORS.includes(body.regulator as CharityRegulator)) {
    return jsonError(`regulator must be one of ${ALLOWED_REGULATORS.join(", ")}`);
  }

  // FY end: body wins; otherwise inherit from Tenant (set in onboarding).
  // If neither has a value, that's a 400 — we need it to know when years end.
  // See decisions log 2026-05-04 (FY end lifted to Tenant).
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { financialYearEndMonth: true, financialYearEndDay: true },
  });
  const yearEndMonth =
    typeof body.yearEndMonth === "number" ? body.yearEndMonth : tenant?.financialYearEndMonth;
  const yearEndDay =
    typeof body.yearEndDay === "number" ? body.yearEndDay : tenant?.financialYearEndDay;

  if (typeof yearEndMonth !== "number" || yearEndMonth < 1 || yearEndMonth > 12) {
    return jsonError("yearEndMonth must be 1..12 (or set on the tenant in onboarding)");
  }
  if (typeof yearEndDay !== "number" || yearEndDay < 1 || yearEndDay > 31) {
    return jsonError("yearEndDay must be 1..31 (or set on the tenant in onboarding)");
  }

  const regulator = body.regulator as CharityRegulator;
  const data = {
    charityNumber: body.charityNumber ?? null,
    regulator,
    yearEndMonth,
    yearEndDay,
    reservesPolicy: body.reservesPolicy ?? null,
    publicBenefitStatement: body.publicBenefitStatement ?? null,
  };

  const wasFirst = !(await prisma.charitySettings.findUnique({ where: { tenantId } }));

  const settings = await prisma.charitySettings.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: data,
  });

  if (wasFirst) {
    await seedCharityDefaults(tenantId, regulator);
  }

  logAudit({
    session,
    action: wasFirst ? "charity.settings.created" : "charity.settings.updated",
    entity: "CharitySettings",
    entityId: settings.id,
    tenantId,
    meta: { regulator, yearEndMonth: data.yearEndMonth, yearEndDay: data.yearEndDay },
  });

  return NextResponse.json({ configured: true, ...settings });
}
