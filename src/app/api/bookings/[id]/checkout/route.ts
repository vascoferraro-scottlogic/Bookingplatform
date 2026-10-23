import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { hasPermission, Permission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { paymentProvider } from "@/lib/payments";

/**
 * POST /api/bookings/[id]/checkout
 *
 * PAID comes only from the payment provider (or, with the stub engine, a club
 * bookings manager completing the checkout on the member's behalf).
 *
 * - The booking owner may START a provider checkout for their own unpaid
 *   booking. The provider decides the outcome: the stub in immediate mode marks
 *   it PAID, webhook/manual modes leave it PENDING. The owner can never set PAID
 *   themselves; any status in the request body is ignored.
 * - A tenant admin / bookings manager of the booking's tenant (or a platform
 *   admin impersonating it) can mark the payment as paid directly.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { payment: true },
  });

  if (!booking) return jsonError("Booking not found", 404);

  const isOwner = booking.userId === session.user.id;
  const eff = getEffective(session);
  const canManagePayments =
    !isOwner && booking.tenantId === eff.tenantId && (await hasPermission(session, booking.tenantId, Permission.bookings_manage));
  if (!isOwner && !canManagePayments) {
    return jsonError("Forbidden", 403);
  }

  if (!booking.payment) {
    return jsonError("No payment associated with this booking", 400);
  }

  if (booking.payment.status !== "PENDING") {
    return jsonError(`Payment is already ${booking.payment.status}`, 400);
  }

  if (booking.status === "CANCELLED" || booking.status === "REFUNDED") {
    return jsonError(`Cannot pay for a ${booking.status.toLowerCase()} booking`, 409);
  }

  if (isOwner) {
    const checkout = await paymentProvider.createBookingCheckout(booking.payment.id, booking.payment.amount, booking.payment.currency);
    const current = await prisma.bookingPayment.findUnique({ where: { id: booking.payment.id } });
    logAudit({ session, action: "payment.checkout_started", entity: "BookingPayment", entityId: booking.payment.id, tenantId: booking.tenantId, meta: { bookingId: id } });
    return NextResponse.json({ ...(current ?? booking.payment), checkoutUrl: checkout.checkoutUrl ?? current?.checkoutUrl ?? booking.payment.checkoutUrl });
  }

  const updated = await prisma.bookingPayment.update({
    where: { id: booking.payment.id },
    data: { status: "PAID" },
  });

  logAudit({ session, action: "payment.manual_paid", entity: "BookingPayment", entityId: booking.payment.id, tenantId: booking.tenantId, meta: { bookingId: id } });

  return NextResponse.json(updated);
}
