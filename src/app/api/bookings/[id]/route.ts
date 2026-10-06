import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { hasPermission, assertPermissionOrFail, Permission } from "@/lib/permissions";
import { getPaymentEngine } from "@/lib/payment";
import { createNotification } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";
import { BookingStatus } from "@prisma/client";

const VALID_TRANSITIONS: Record<string, BookingStatus[]> = {
  REQUESTED: ["APPROVED", "CANCELLED"],
  APPROVED: ["RESERVED", "CANCELLED"],
  RESERVED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["CANCELLED", "NO_SHOW"],
  CANCELLED: ["REFUNDED"],
};

/** Update booking status (state machine). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const { status: newStatus } = await req.json() as { status: BookingStatus };

  const booking = await prisma.booking.findUnique({ where: { id }, include: { payment: true } });
  if (!booking) return jsonError("Not found", 404);

  // Tenant isolation: must be same tenant via real membership OR active impersonation.
  // A non-impersonating PLATFORM_ADMIN no longer has cross-tenant power here.
  const eff = getEffective(session);
  if (booking.tenantId !== eff.tenantId) {
    if (session.user.role === "PLATFORM_ADMIN" && !eff.isImpersonating) {
      return jsonError("PLATFORM_ADMIN_NO_CONTEXT", 403);
    }
    return jsonError("Forbidden", 403);
  }

  // Only members with bookings management privileges can approve/reserve/confirm
  if (["APPROVED", "RESERVED", "CONFIRMED"].includes(newStatus)) {
    const permErr = await assertPermissionOrFail(session, booking.tenantId, Permission.bookings_manage);
    if (permErr) return permErr;
  }

  // Marking a booking as a no-show is a management action used to label the
  // outcome of a confirmed booking once its date has passed. It is the ground
  // truth the no-show prediction model trains and evaluates against, so it is
  // restricted to bookings-managers and only permitted after the play date.
  if (newStatus === "NO_SHOW") {
    const permErr = await assertPermissionOrFail(session, booking.tenantId, Permission.bookings_manage);
    if (permErr) return permErr;
    const bookingDate = new Date(booking.date);
    if (bookingDate.getTime() > Date.now()) {
      return jsonError("Cannot mark a booking as a no-show before its scheduled date.", 400);
    }
  }

  // Users can cancel their own bookings (REQUESTED or APPROVED only).
  // If the caller has bookings management permission they may cancel freely.
  if (newStatus === "CANCELLED") {
    const canManage = await hasPermission(session, booking.tenantId, Permission.bookings_manage);
    if (!canManage) {
      if (booking.userId !== session.user.id) {
        return jsonError("Forbidden", 403);
      }
      if (!["REQUESTED", "APPROVED"].includes(booking.status)) {
        return jsonError("You can only cancel bookings that are requested or approved", 400);
      }
      // Prevent cancellation within 24 hours of the booking date
      const bookingDate = new Date(booking.date);
      const now = new Date();
      const hoursUntilBooking = (bookingDate.getTime() - now.getTime()) / (1000 * 60 * 60);
      if (hoursUntilBooking < 24) {
        return jsonError("Cannot cancel bookings within 24 hours of the scheduled date. Contact an admin for assistance.", 400);
      }
    }
  }

  const allowed = VALID_TRANSITIONS[booking.status];
  if (!allowed?.includes(newStatus)) {
    return jsonError(`Cannot transition from ${booking.status} to ${newStatus}`, 400);
  }

  // Payment flow: when approving, create checkout
  if (newStatus === "RESERVED" && !booking.payment) {
    const engine = getPaymentEngine();
    const result = await engine.createCheckout({
      amount: 1000, // placeholder amount — tenant pricing TBD
      currency: "GBP",
      bookingId: booking.id,
      returnUrl: `${process.env.NEXTAUTH_URL}/bookings/${booking.id}/success`,
    });
    if (!result.success) {
      return jsonError(result.error ?? "Payment failed", 402);
    }
    await prisma.bookingPayment.create({
      data: { bookingId: booking.id, amount: 1000, status: "PENDING", checkoutUrl: result.checkoutUrl },
    });
  }

  // Refund on cancel if payment exists
  if (newStatus === "CANCELLED" && booking.payment?.status === "PAID") {
    const engine = getPaymentEngine();
    const result = await engine.refund({ paymentId: booking.payment.id, amount: booking.payment.amount });
    if (result.success) {
      await prisma.bookingPayment.update({ where: { id: booking.payment.id }, data: { status: "REFUNDED" } });
    }
  }

  const updated = await prisma.booking.update({ where: { id }, data: { status: newStatus } });

  // When a booking is labelled a no-show, backfill the ground-truth outcome on
  // any prediction rows the model produced for it, so eval can score them.
  if (newStatus === "NO_SHOW") {
    await prisma.bookingNoShowPrediction.updateMany({
      where: { bookingId: id },
      data: { actualNoShow: true },
    });
  }

  logAudit({ session, action: `booking.${newStatus.toLowerCase()}`, entity: "Booking", entityId: id, tenantId: booking.tenantId, meta: { from: booking.status, to: newStatus } });

  // Notify user of status changes
  if (booking.userId !== session.user.id) {
    const typeMap: Record<string, string> = { APPROVED: "BOOKING_APPROVED", CANCELLED: "BOOKING_CANCELLED" };
    const notifType = typeMap[newStatus];
    if (notifType) {
      await createNotification({
        tenantId: booking.tenantId,
        userId: booking.userId,
        type: notifType as any,
        title: `Booking ${newStatus.toLowerCase()}`,
        body: `Your booking for ${booking.date} has been ${newStatus.toLowerCase()}.`,
      });
    }
  }

  // Notify waitlist when a slot is cancelled
  if (newStatus === "CANCELLED") {
    const waiters = await prisma.waitlistEntry.findMany({
      where: { bookingId: booking.id },
      orderBy: { createdAt: "asc" },
    });
    for (const w of waiters) {
      await createNotification({
        tenantId: booking.tenantId,
        userId: w.userId,
        type: "WAITLIST_AVAILABLE",
        title: "Slot now available",
        body: `A slot on ${booking.date} is now available. Book it before it's gone!`,
      });
    }
  }

  return NextResponse.json(updated);
}
