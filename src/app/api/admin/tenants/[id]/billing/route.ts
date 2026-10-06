import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertRoleOrFail, rejectIfImpersonating, jsonError } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";

/** GET billing profile + payment history for a tenant — PLATFORM_ADMIN. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;

  const { id: tenantId } = await params;

  const profile = await prisma.tenantBillingProfile.findUnique({
    where: { tenantId },
    include: { plan: true },
  });

  const payments = await prisma.tenantPayment.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { lineItems: true },
  });

  const outstanding = payments
    .filter((p) => p.status === "PENDING")
    .reduce((sum, p) => sum + p.amount, 0);

  const totalRevenue = payments
    .filter((p) => p.status === "PAID")
    .reduce((sum, p) => sum + p.amount, 0);

  logAudit({ session, action: "billing.admin.tenant_viewed", entity: "TenantBillingProfile", entityId: profile?.id, tenantId, piiAccess: true });

  return NextResponse.json({ profile, payments, outstanding, totalRevenue });
}

/** PATCH billing profile for a tenant (plan change, status) — PLATFORM_ADMIN. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const { id: tenantId } = await params;

  const profile = await prisma.tenantBillingProfile.findUnique({ where: { tenantId } });
  if (!profile) return jsonError("No billing profile for this tenant", 404);

  const body = await req.json().catch(() => null);
  if (!body) return jsonError("Invalid JSON");

  const data: Record<string, unknown> = {};

  // Plan change
  if (body.planId) {
    const plan = await prisma.platformPlan.findUnique({ where: { id: body.planId } });
    if (!plan) return jsonError("Plan not found", 404);
    data.planId = body.planId;
  }

  // Status change
  if (body.billingStatus) {
    const valid = ["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"];
    if (!valid.includes(body.billingStatus)) return jsonError("Invalid billing status");
    data.billingStatus = body.billingStatus;
  }

  // Contact overrides (admin can also set these)
  for (const key of ["billingContactName", "billingContactEmail", "billingAddress", "vatNumber", "paymentMethod"]) {
    if (body[key] !== undefined) data[key] = body[key];
  }

  if (Object.keys(data).length === 0) return jsonError("No valid fields to update");

  const updated = await prisma.tenantBillingProfile.update({ where: { tenantId }, data });

  logAudit({ session, action: "billing.admin.profile_updated", entity: "TenantBillingProfile", entityId: profile.id, tenantId, meta: { fields: Object.keys(data) } });

  return NextResponse.json(updated);
}
