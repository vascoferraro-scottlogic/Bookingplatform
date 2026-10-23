import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import crypto from "crypto";

/** True when `signature` is the hex HMAC we expect. Unequal lengths are simply invalid. */
function signatureMatches(signature: string, expected: string): boolean {
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Payment provider webhook — receives payment confirmations/failures.
 * Verifies signature, processes payment status updates.
 *
 * Expected headers:
 *   x-payment-signature: HMAC-SHA256 of `${timestamp}.${rawBody}` with PAYMENT_WEBHOOK_SECRET
 *   x-payment-timestamp: Unix timestamp (seconds) of when the event was sent
 *
 * Body: { eventId (or id), eventType, paymentId, bookingId, status, amount, metadata? }
 *
 * Fails closed: with no PAYMENT_WEBHOOK_SECRET configured every event is rejected.
 * Each event id is processed once, and status changes are state-guarded so a
 * late or replayed event can't move a payment or booking backwards.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 401 });
  }

  const signature = req.headers.get("x-payment-signature");
  const timestamp = req.headers.get("x-payment-timestamp");

  if (!signature || !timestamp) {
    return NextResponse.json({ error: "Missing signature headers" }, { status: 401 });
  }

  // Replay protection — reject events older than 5 minutes (and non-numeric timestamps)
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() / 1000 - sentAt) > 300) {
    return NextResponse.json({ error: "Invalid or stale event timestamp" }, { status: 401 });
  }

  const rawBody = await req.text();

  // Verify HMAC signature
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  if (!signatureMatches(signature, expectedSignature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: {
    eventId?: string;
    id?: string;
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
  const eventId = payload.eventId ?? payload.id;

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

  if (!["payment.completed", "payment.failed", "payment.refunded"].includes(eventType)) {
    return NextResponse.json({ received: true, action: "unhandled_event" });
  }

  const tenantId = payment.booking.tenantId;
  const systemSession = { user: { id: "system", role: "PLATFORM_ADMIN" as const, tenantId } };

  // Record the event id and apply the change in one transaction: a replay hits
  // the unique event id (P2002) and is a no-op; a failure rolls the id back so
  // the provider's retry is processed.
  let action: "processed" | "ignored";
  try {
    action = await prisma.$transaction(async (tx) => {
      if (eventId) {
        await tx.processedWebhookEvent.create({ data: { eventId, source: "bookings" } });
      }

      switch (eventType) {
        case "payment.completed": {
          // Only a payment still awaiting settlement can become PAID.
          const paid = await tx.bookingPayment.updateMany({
            where: { id: payment.id, status: { in: ["PENDING", "FAILED"] } },
            data: { status: "PAID" },
          });
          if (paid.count === 0) return "ignored";
          // Auto-confirm a RESERVED booking; never revive CANCELLED/REFUNDED ones.
          await tx.booking.updateMany({
            where: { id: bookingId, status: "RESERVED" },
            data: { status: "CONFIRMED" },
          });
          return "processed";
        }

        case "payment.failed": {
          // A late failure never overrides a payment that has already settled.
          const failed = await tx.bookingPayment.updateMany({
            where: { id: payment.id, status: "PENDING" },
            data: { status: "FAILED" },
          });
          return failed.count === 0 ? "ignored" : "processed";
        }

        default: {
          // payment.refunded
          const refunded = await tx.bookingPayment.updateMany({
            where: { id: payment.id, status: { in: ["PAID", "REFUND_FAILED"] } },
            data: { status: "REFUNDED" },
          });
          if (refunded.count === 0) return "ignored";
          await tx.booking.updateMany({
            where: { id: bookingId, status: "CANCELLED" },
            data: { status: "REFUNDED" },
          });
          return "processed";
        }
      }
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") {
      return NextResponse.json({ received: true, action: "already_processed" });
    }
    throw err;
  }

  if (action === "processed") {
    if (eventType === "payment.completed") {
      logAudit({ session: systemSession, action: "payment.webhook_confirmed", entity: "BookingPayment", entityId: payment.id, tenantId, meta: { bookingId, amount: payment.amount, bookingStatus: payment.booking.status } });
    } else if (eventType === "payment.failed") {
      logAudit({ session: systemSession, action: "payment.webhook_failed", entity: "BookingPayment", entityId: payment.id, tenantId, meta: { bookingId, reason: status } });
    } else {
      logAudit({ session: systemSession, action: "payment.webhook_refunded", entity: "BookingPayment", entityId: payment.id, tenantId, meta: { bookingId, amount: payment.amount } });
    }
  }

  return NextResponse.json({ received: true, action });
}
