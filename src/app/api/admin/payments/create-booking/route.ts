import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

/**
 * Manually create a payment for a booking. Needs a tenant context: a tenant
 * admin, or a platform admin who is impersonating the booking's tenant.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;
  // A non-impersonating platform admin has no tenant context (403).
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const body = await req.json().catch(() => null);
  if (!body || !body.bookingId || !body.amount) return jsonError("bookingId and amount required");

  const { bookingId, amount, processNow } = body as { bookingId: string; amount: number; processNow?: boolean };

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.tenantId !== tenantId) return jsonError("Booking not found", 404);

  // Only a RESERVED booking can be confirmed by payment (transition map).
  if (processNow && booking.status !== "RESERVED") {
    return jsonError(`Cannot confirm a ${booking.status.toLowerCase()} booking by payment`, 409);
  }

  const payment = await prisma.bookingPayment.create({ data: { bookingId, amount, status: "PENDING" } });

  logAudit({ session, action: "billing.admin.manual_booking_payment_created", entity: "BookingPayment", entityId: payment.id, tenantId: booking.tenantId, meta: { amount } });

  if (processNow) {
    // Mark paid and confirm booking immediately (stub behaviour)
    await prisma.bookingPayment.update({ where: { id: payment.id }, data: { status: "PAID" } });
    await prisma.booking.update({ where: { id: bookingId }, data: { status: "CONFIRMED" } });
  }

  return NextResponse.json({ ok: true, paymentId: payment.id });
}
