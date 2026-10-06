import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import crypto from "crypto";

const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? "whsec_test_default_secret";

/**
 * Payment provider webhook — receives payment confirmations/failures.
 * Verifies signature, processes payment status updates.
 *
 * Expected headers:
 *   x-payment-signature: HMAC-SHA256 of the raw body with PAYMENT_WEBHOOK_SECRET
 *   x-payment-timestamp: Unix timestamp (seconds) of when the event was sent
 *
 * Body: { eventType, paymentId, bookingId, status, amount, metadata? }
 */
export async function POST(req: NextRequest) {
  const signature = req.headers.get("x-payment-signature");
  const timestamp = req.headers.get("x-payment-timestamp");

  if (!signature || !timestamp) {
    return NextResponse.json({ error: "Missing signature headers" }, { status: 401 });
  }

  // Replay protection — reject events older than 5 minutes
  const eventAge = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (eventAge > 300) {
    return NextResponse.json({ error: "Event timestamp too old" }, { status: 401 });
  }

  const rawBody = await req.text();

  // Verify HMAC signature
  const expectedSignature = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  if (signature !== expectedSignature) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: {
    eventType: string;
    paymentId?: string;
    bookingId: string;
    status: string;
    amount?: number;
    metadata?: Record<string, unknown>;
  };

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { eventType, bookingId, status } = payload;

  if (!eventType || !bookingId) {
    return NextResponse.json({ error: "eventType and bookingId required" }, { status: 400 });
  }

  // Find the booking payment
  const payment = await prisma.bookingPayment.findFirst({
    where: { bookingId },
    include: { booking: true },
  });

  if (!payment) {
    // Acknowledge but ignore — payment may not exist yet (race with checkout creation)
    return NextResponse.json({ received: true, action: "ignored" });
  }

  // Process based on event type
  switch (eventType) {
    case "payment.completed": {
      if (payment.status === "PAID") {
        // Idempotent — already processed
        return NextResponse.json({ received: true, action: "already_processed" });
      }
      await prisma.bookingPayment.update({
        where: { id: payment.id },
        data: { status: "PAID" },
      });
      // Auto-confirm booking on successful payment
      await prisma.booking.update({
        where: { id: bookingId },
        data: { status: "CONFIRMED" },
      });
      logAudit({
        session: { user: { id: "system", role: "PLATFORM_ADMIN", tenantId: payment.booking.tenantId } },
        action: "payment.webhook_confirmed",
        entity: "BookingPayment",
        entityId: payment.id,
        tenantId: payment.booking.tenantId,
        meta: { bookingId, amount: payment.amount },
      });
      break;
    }

    case "payment.failed": {
      await prisma.bookingPayment.update({
        where: { id: payment.id },
        data: { status: "FAILED" },
      });
      logAudit({
        session: { user: { id: "system", role: "PLATFORM_ADMIN", tenantId: payment.booking.tenantId } },
        action: "payment.webhook_failed",
        entity: "BookingPayment",
        entityId: payment.id,
        tenantId: payment.booking.tenantId,
        meta: { bookingId, reason: status },
      });
      break;
    }

    case "payment.refunded": {
      await prisma.bookingPayment.update({
        where: { id: payment.id },
        data: { status: "REFUNDED" },
      });
      break;
    }

    default:
      return NextResponse.json({ received: true, action: "unhandled_event" });
  }

  return NextResponse.json({ received: true, action: "processed" });
}
