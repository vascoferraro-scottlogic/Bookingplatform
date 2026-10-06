import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertRoleOrFail, rejectIfImpersonating, jsonError } from "@/lib/api-utils";
import { paymentProvider } from "@/lib/payments";
import { logAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const body = await req.json().catch(() => null);
  if (!body || !body.tenantId || !body.amount) return jsonError("tenantId and amount required");

  const { tenantId, amount, processNow } = body as { tenantId: string; amount: number; processNow?: boolean };

  const profile = await prisma.tenantBillingProfile.findUnique({ where: { tenantId } });
  if (!profile) return jsonError("Tenant has no billing profile", 404);

  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.tenantPayment.create({
      data: {
        tenantId,
        billingProfileId: profile.id,
        amount,
        status: "PENDING",
        type: "ADJUSTMENT",
      },
    });

    await tx.invoiceLineItem.create({
      data: {
        paymentId: p.id,
        description: "Manual stub payment",
        quantity: 1,
        unitPricePence: amount,
        totalPricePence: amount,
        category: "ADDON",
        sortOrder: 0,
      },
    });

    return p;
  });

  logAudit({ session, action: "billing.admin.manual_payment_created", entity: "TenantPayment", entityId: payment.id, tenantId, meta: { amount } });

  if (processNow) {
    try {
      const res = await paymentProvider.chargeTenantPayment(payment.id);
      if (res.status === "PAID") {
        await prisma.tenantPayment.update({ where: { id: payment.id }, data: { status: "PAID" } });
      } else if (res.status === "FAILED") {
        await prisma.tenantPayment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
      }
    } catch (e) {
      // ignore — leave pending
    }
  }

  return NextResponse.json({ ok: true, paymentId: payment.id });
}
