import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { hasPermission, assertPermissionOrFail, Permission } from "@/lib/permissions";
import { getPaymentEngine } from "@/lib/payment";
import { createNotification } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";
import { bookingStart, startsMoreThanHoursAway, CANCELLATION_WINDOW_HOURS } from "@/lib/booking-time";
import { BookingStatus } from "@prisma/client";

const VALID_TRANSITIONS: Record<string, BookingStatus[]> = {
  REQUESTED: ["APPROVED", "CANCELLED"],
  APPROVED: ["RESERVED", "CANCELLED"],
  RESERVED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["CANCELLED", "NO_SHOW"],
  CANCELLED: ["REFUNDED"],
};

/** Only RESERVED and CONFIRMED bookings hold a slot (D-02). */
const SLOT_HOLDING: BookingStatus[] = ["RESERVED", "CONFIRMED"];

class SlotClashError extends Error {}

/** Update booking status (state machine). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const { status: newStatus } = await req.json() as { status: BookingStatus };

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { payment: true, slots: true, tenant: { select: { timezone: true, bookingFeePence: true } } },
  });
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

  const isTenantAdmin = eff.role === "TENANT_ADMIN";
  const slotStart = bookingStart(booking, booking.tenant?.timezone);

  // Only members with bookings management privileges can approve/reserve/confirm
  if (["APPROVED", "RESERVED", "CONFIRMED"].includes(newStatus)) {
    const permErr = await assertPermissionOrFail(session, booking.tenantId, Permission.bookings_manage);
    if (permErr) return permErr;
  }

  // Marking a booking as a no-show is a management action used to label the
  // outcome of a confirmed booking once its slot has started (D-13). It is the
  // ground truth the no-show prediction model trains and evaluates against, so
  // it is restricted to bookings-managers.
  if (newStatus === "NO_SHOW") {
    const permErr = await assertPermissionOrFail(session, booking.tenantId, Permission.bookings_manage);
    if (permErr) return permErr;
    if (slotStart.getTime() > Date.now()) {
      return jsonError("Cannot mark a booking as a no-show before its slot has started.", 400);
    }
  }

  // REFUNDED is only ever the result of a real refund (D-06): a tenant admin may
  // record it once the payment itself is REFUNDED, nobody else may set it.
  if (newStatus === "REFUNDED") {
    if (!isTenantAdmin) return jsonError("Forbidden", 403);
    if (booking.payment?.status !== "REFUNDED") {
      return jsonError("A booking can only be marked refunded once its payment has been refunded", 409);
    }
  }

  // Cancellation (D-04). The owner (or a bookings manager) may cancel a RESERVED
  // or CONFIRMED booking only when its slot starts MORE than 48 hours away;
  // at or inside 48 hours only a tenant admin may.
  if (newStatus === "CANCELLED" && !isTenantAdmin) {
    const isOwner = booking.userId === session.user.id;
    const canManage = await hasPermission(session, booking.tenantId, Permission.bookings_manage);
    if (!isOwner && !canManage) {
      return jsonError("Forbidden", 403);
    }
    if (SLOT_HOLDING.includes(booking.status) && !startsMoreThanHoursAway(slotStart, CANCELLATION_WINDOW_HOURS)) {
      return jsonError(
        `Bookings can only be cancelled more than ${CANCELLATION_WINDOW_HOURS} hours before the slot. Contact a club admin for assistance.`,
        403,
      );
    }
  }

  const allowed = VALID_TRANSITIONS[booking.status];
  if (!allowed?.includes(newStatus)) {
    return jsonError(`Cannot transition from ${booking.status} to ${newStatus}`, 400);
  }

  // Approve/reserve/confirm re-check for a clash and change status in one
  // transaction, so two bookings can't both take the slot (D-02, NFR-08).
  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      if (["APPROVED", "RESERVED", "CONFIRMED"].includes(newStatus)) {
        for (const slot of booking.slots) {
          const clash = await tx.bookingSlot.findFirst({
            where: {
              rinkId: slot.rinkId,
              timeSlot: slot.timeSlot,
              bookingId: { not: booking.id },
              booking: { date: booking.date, tenantId: booking.tenantId, status: { in: SLOT_HOLDING } },
            },
          });
          if (clash) throw new SlotClashError(`Rink ${slot.rinkId} slot ${slot.timeSlot} on ${booking.date} is already held`);
        }
      }
      return tx.booking.update({ where: { id }, data: { status: newStatus } });
    }, { isolationLevel: "Serializable" });
  } catch (err) {
    if (err instanceof SlotClashError) return jsonError(err.message, 409);
    if ((err as { code?: string })?.code === "P2034") return jsonError("The slot was changed by another request, please retry", 409);
    throw err;
  }

  let warning: string | undefined;

  // Payment flow (D-01): checkout is created when a booking is confirmed, for
  // the club's per-booking fee (FR-PAY-005) x number of slots. The
  // BookingPayment is created first so the provider is given its id.
  if (newStatus === "CONFIRMED" && !booking.payment) {
    const amount = (booking.tenant?.bookingFeePence ?? 0) * booking.slots.length;
    if (amount > 0) {
      const payment = await prisma.bookingPayment.create({
        data: { bookingId: booking.id, amount, status: "PENDING" },
      });
      const result = await getPaymentEngine().createCheckout({
        amount,
        currency: "GBP",
        bookingId: payment.id,
        returnUrl: `${process.env.NEXTAUTH_URL}/bookings/${booking.id}/success`,
      });
      if (!result.success) {
        warning = `Booking confirmed, but payment could not be started: ${result.error ?? "Payment failed"}`;
      } else if (result.checkoutUrl) {
        await prisma.bookingPayment.update({ where: { id: payment.id }, data: { checkoutUrl: result.checkoutUrl } });
      }
    }
  }

  // Refund on cancel if the booking was paid. A member can only get here
  // outside the 48-hour window; a tenant admin may cancel at any time (D-06).
  // A failed refund doesn't undo the cancellation: the payment is flagged
  // REFUND_FAILED for an admin to follow up.
  if (newStatus === "CANCELLED" && booking.payment?.status === "PAID") {
    let refunded = false;
    let refundError: string | undefined;
    try {
      const result = await getPaymentEngine().refund({ paymentId: booking.payment.id, amount: booking.payment.amount });
      refunded = result.success;
      refundError = result.error;
    } catch (err) {
      refundError = String(err);
    }
    await prisma.bookingPayment.update({
      where: { id: booking.payment.id },
      data: { status: refunded ? "REFUNDED" : "REFUND_FAILED" },
    });
    if (!refunded) {
      warning = `Booking cancelled, but the refund failed${refundError ? ` (${refundError})` : ""}. An admin needs to follow it up.`;
      logAudit({ session, action: "booking.refund_failed", entity: "BookingPayment", entityId: booking.payment.id, tenantId: booking.tenantId, meta: { bookingId: id, error: refundError } });
    }
  }

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

  // Waiting list (D-03): cancelling a CONFIRMED booking hands the slot to the
  // first waiter as a REQUESTED booking and notifies only them. The remaining
  // waiters stay queued, in order, against the new booking.
  if (newStatus === "CANCELLED" && booking.status === "CONFIRMED") {
    const first = await prisma.waitlistEntry.findFirst({
      where: { bookingId: booking.id },
      orderBy: { createdAt: "asc" },
    });
    if (first) {
      const assigned = await prisma.booking.create({
        data: {
          tenantId: booking.tenantId,
          userId: first.userId,
          bookedByUserId: first.userId,
          date: booking.date,
          status: "REQUESTED",
          slots: {
            create: booking.slots.map((s) => ({ rinkId: s.rinkId, timeSlot: s.timeSlot, greenName: s.greenName })),
          },
        },
      });
      await prisma.waitlistEntry.delete({ where: { id: first.id } });
      await prisma.waitlistEntry.updateMany({
        where: { bookingId: booking.id },
        data: { bookingId: assigned.id },
      });
      await createNotification({
        tenantId: booking.tenantId,
        userId: first.userId,
        type: "WAITLIST_AVAILABLE",
        title: "Slot now available",
        body: `A slot on ${booking.date} is now available and has been requested for you. Check your bookings.`,
      });
    }
  }

  return NextResponse.json(warning ? { ...updated, warning } : updated);
}
