import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail, assertRoleOrFail, rejectIfImpersonating, jsonError } from "@/lib/api-utils";
import { paymentProvider } from "@/lib/payments";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

/**
 * POST /api/payments/simulate
 *
 * Admin-only endpoint to simulate provider events (useful in manual mode).
 */
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const body = await req.json().catch(() => null);
  if (!body || !body.type) return jsonError("Invalid body");

  // Booking-targeted event (bookingId provided or explicit target)
  if (body.bookingId || body.target === "booking") {
    const payment = await prisma.bookingPayment.findFirst({
      where: body.bookingId ? { bookingId: body.bookingId } : { id: body.paymentId },
      include: { booking: true },
    });

    if (!payment) {
      return NextResponse.json({ ok: true, action: "ignored" });
    }

    const t = body.type;
    if (t === "payment_succeeded" || t === "payment.completed") {
      if (payment.status === "PAID") return NextResponse.json({ ok: true, action: "already_processed" });
      await prisma.bookingPayment.update({ where: { id: payment.id }, data: { status: "PAID" } });
      await prisma.booking.update({ where: { id: payment.bookingId }, data: { status: "CONFIRMED" } });
      logAudit({
        session: { user: { id: "system", role: "PLATFORM_ADMIN", tenantId: payment.booking.tenantId } },
        action: "payment.webhook_confirmed",
        entity: "BookingPayment",
        entityId: payment.id,
        tenantId: payment.booking.tenantId,
        meta: { bookingId: payment.bookingId, amount: payment.amount },
      });
      return NextResponse.json({ ok: true, action: "processed" });
    } else if (t === "payment_failed" || t === "payment.failed") {
      await prisma.bookingPayment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
      logAudit({
        session: { user: { id: "system", role: "PLATFORM_ADMIN", tenantId: payment.booking.tenantId } },
        action: "payment.webhook_failed",
        entity: "BookingPayment",
        entityId: payment.id,
        tenantId: payment.booking.tenantId,
        meta: { bookingId: payment.bookingId, reason: body.reason ?? t },
      });
      return NextResponse.json({ ok: true, action: "processed" });
    } else if (t === "payment.refunded" || t === "payment_refunded") {
      await prisma.bookingPayment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } });
      return NextResponse.json({ ok: true, action: "processed" });
    } else {
      return jsonError("Unhandled booking event type");
    }
  }

  // Tenant/Platform payments — forward to provider handler (tenantPayment updates)
  try {
    await paymentProvider.handleWebhookEvent(body, {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    return new NextResponse(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
