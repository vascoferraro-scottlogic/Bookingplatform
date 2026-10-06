import type { PaymentProvider, CreateCheckoutResult, ChargeResult } from "./provider";
import { prisma } from "@/lib/prisma";

const MODE = process.env.PAYMENT_STUB_MODE ?? "immediate"; // immediate | webhook | manual
const WEBHOOK_BASE = process.env.PAYMENT_STUB_WEBHOOK_BASE ?? "http://localhost:3000";
const SECRET = process.env.PAYMENT_STUB_SECRET ?? "";

export class StubPaymentProvider implements PaymentProvider {
  async createBookingCheckout(bookingPaymentId: string, amount: number, currency = "GBP"): Promise<CreateCheckoutResult> {
    const checkoutUrl = `https://stub.payments.local/checkout/${bookingPaymentId}`;
    try {
      await prisma.bookingPayment.update({ where: { id: bookingPaymentId }, data: { checkoutUrl, status: "PENDING" } });
    } catch (e) {
      // ignore
    }

    if (MODE === "immediate") {
      try {
        await prisma.bookingPayment.update({ where: { id: bookingPaymentId }, data: { status: "PAID" } });
      } catch (e) {
        // ignore
      }
    }

    return { checkoutUrl, providerSessionId: `stub_sess_${bookingPaymentId}` };
  }

  async chargeTenantPayment(tenantPaymentId: string): Promise<ChargeResult> {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_STUB_IN_PROD !== "true") {
      return { status: "PENDING", providerId: "stub-not-allowed", message: "Stub not allowed in production" };
    }

    const providerId = `stub_${tenantPaymentId}`;

    if (MODE === "immediate") {
      try {
        await prisma.tenantPayment.update({ where: { id: tenantPaymentId }, data: { status: "PAID" } });
        return { status: "PAID", providerId };
      } catch (e) {
        return { status: "FAILED", providerId, message: String(e) };
      }
    }

    if (MODE === "webhook") {
      // leave PENDING and fire a delayed webhook to the local server
      setTimeout(async () => {
        try {
          await fetch(`${WEBHOOK_BASE}/api/payments/webhook`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(SECRET ? { Authorization: `Bearer ${SECRET}` } : {}) },
            body: JSON.stringify({ type: "payment_succeeded", paymentId: tenantPaymentId, providerId }),
          });
        } catch (e) {
          // no-op
        }
      }, 1500);
      return { status: "PENDING", providerId };
    }

    // manual mode — operator will call simulate endpoint
    return { status: "PENDING", providerId };
  }

  async handleWebhookEvent(body: any): Promise<void> {
    const t = body?.type;
    if (!t) return;
    if (t === "payment_succeeded") {
      const pid = body.paymentId;
      if (!pid) return;
      try {
        await prisma.tenantPayment.update({ where: { id: pid }, data: { status: "PAID" } });
      } catch (e) {
        // ignore
      }
    } else if (t === "payment_failed") {
      const pid = body.paymentId;
      if (!pid) return;
      try {
        await prisma.tenantPayment.update({ where: { id: pid }, data: { status: "FAILED" } });
      } catch (e) {
        // ignore
      }
    }
  }

  async refundPayment(paymentId: string, amount?: number) {
    try {
      await prisma.tenantPayment.update({ where: { id: paymentId }, data: { status: "REFUNDED" } });
      return { success: true, providerId: `refund_${paymentId}` };
    } catch (e) {
      return { success: false };
    }
  }
}
