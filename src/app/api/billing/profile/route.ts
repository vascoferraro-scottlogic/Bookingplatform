import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

/** GET own billing profile — TENANT_ADMIN. */
export async function GET() {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;
  const { tenantId, error: tErr } = resolveTenantId(session);
  if (tErr) return tErr;

  const profile = await prisma.tenantBillingProfile.findUnique({
    where: { tenantId },
    include: { plan: { select: { id: true, name: true, slug: true, priceMonthlyPence: true, maxMembers: true, maxGreens: true, includedStreamingTier: true } } },
  });

  if (!profile) return jsonError("No billing profile found", 404);

  logAudit({ session, action: "billing.profile.viewed", entity: "TenantBillingProfile", entityId: profile.id, tenantId });

  return NextResponse.json(profile);
}

/** PATCH own billing profile (contact details, address, VAT) — TENANT_ADMIN. */
export async function PATCH(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;
  const { tenantId, error: tErr } = resolveTenantId(session);
  if (tErr) return tErr;

  const profile = await prisma.tenantBillingProfile.findUnique({ where: { tenantId } });
  if (!profile) return jsonError("No billing profile found", 404);

  const body = await req.json().catch(() => null);
  if (!body) return jsonError("Invalid JSON");

  // Tenant admins can only update contact/address/VAT — not plan or status
  const allowedFields = ["billingContactName", "billingContactEmail", "billingAddress", "vatNumber"];
  const data: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (body[key] !== undefined) data[key] = body[key];
  }

  if (Object.keys(data).length === 0) return jsonError("No valid fields to update");

  const updated = await prisma.tenantBillingProfile.update({ where: { tenantId }, data });

  logAudit({ session, action: "billing.profile.updated", entity: "TenantBillingProfile", entityId: profile.id, tenantId, meta: { fields: Object.keys(data) } });

  return NextResponse.json(updated);
}
