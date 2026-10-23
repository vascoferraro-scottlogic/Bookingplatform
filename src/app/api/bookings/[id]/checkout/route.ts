import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { hasPermission, Permission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

/**
 * POST /api/bookings/[id]/checkout — mark payment as PAID (stub engine only).
 *
 * In production PAID comes only from a verified provider event (the payment
 * webhook). With the stub engine a club's bookings manager can complete the
 * checkout on the member's behalf. The booking owner can't mark their own
 * payment as paid.
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

  // Only a tenant admin / bookings manager of the booking's tenant (or a
  // platform admin impersonating it) can complete checkout.
  const eff = getEffective(session);
  const canManagePayments = booking.tenantId === eff.tenantId && (await hasPermission(session, booking.tenantId, Permission.bookings_manage));
  if (!canManagePayments) {
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

  const updated = await prisma.bookingPayment.update({
    where: { id: booking.payment.id },
    data: { status: "PAID" },
  });

  logAudit({ session, action: "payment.manual_paid", entity: "BookingPayment", entityId: booking.payment.id, tenantId: booking.tenantId, meta: { bookingId: id } });

  return NextResponse.json(updated);
}
