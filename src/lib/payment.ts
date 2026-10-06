/**
 * Pluggable payment engine — § Payments in FEATURES.md
 *
 * Interface + configurable stub for MVP.
 * Swap in a real provider (Stripe, etc.) by implementing PaymentEngine.
 */

export interface CheckoutResult {
  success: boolean;
  checkoutUrl?: string;
  error?: string;
}

export interface RefundResult {
  success: boolean;
  error?: string;
}

export interface PaymentEngine {
  createCheckout(params: {
    amount: number;
    currency: string;
    bookingId: string;
    returnUrl: string;
  }): Promise<CheckoutResult>;

  refund(params: { paymentId: string; amount: number }): Promise<RefundResult>;
}

// ── Configurable Stub ────────────────────────────────────────

type Outcome = "success" | "decline" | "insufficient_funds" | "expired_card" | "network_error";

let nextCheckoutOutcome: Outcome = "success";
let nextRefundOutcome: Outcome = "success";

export function setNextCheckoutOutcome(o: Outcome) {
  nextCheckoutOutcome = o;
}
export function setNextRefundOutcome(o: Outcome) {
  nextRefundOutcome = o;
}
export function resetOutcomes() {
  nextCheckoutOutcome = "success";
  nextRefundOutcome = "success";
}

function outcomeToResult(outcome: Outcome, successValue: Record<string, unknown>): CheckoutResult | RefundResult {
  switch (outcome) {
    case "success":
      return { success: true, ...successValue };
    case "decline":
      return { success: false, error: "Card declined" };
    case "insufficient_funds":
      return { success: false, error: "Insufficient funds" };
    case "expired_card":
      return { success: false, error: "Card expired" };
    case "network_error":
      return { success: false, error: "Network error — try again" };
  }
}

export const stubPaymentEngine: PaymentEngine = {
  async createCheckout({ bookingId, returnUrl }) {
    const result = outcomeToResult(nextCheckoutOutcome, {
      checkoutUrl: `${returnUrl}?bookingId=${encodeURIComponent(bookingId)}&stub=1`,
    });
    nextCheckoutOutcome = "success"; // auto-reset after use
    return result as CheckoutResult;
  },

  async refund() {
    const result = outcomeToResult(nextRefundOutcome, {});
    nextRefundOutcome = "success";
    return result as RefundResult;
  },
};

import { paymentProvider } from "@/lib/payments";

/** Adapter that forwards booking + refund calls to the configured payment provider. */
export const providerPaymentEngine: PaymentEngine = {
  async createCheckout({ amount, currency, bookingId, returnUrl }) {
    try {
      const res = await paymentProvider.createBookingCheckout(bookingId, amount, currency);
      if (res.checkoutUrl) return { success: true, checkoutUrl: res.checkoutUrl };
      return { success: false, error: "payment provider did not return a checkout URL" };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },
  async refund({ paymentId, amount }) {
    try {
      const result = await paymentProvider.refundPayment(paymentId, amount);
      return { success: result.success, error: result.success ? undefined : "refund failed" };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },
};

/** Active engine — forward to provider-backed adapter by default. */
let activeEngine: PaymentEngine = providerPaymentEngine;

export function getPaymentEngine(): PaymentEngine {
  return activeEngine;
}

export function setPaymentEngine(engine: PaymentEngine) {
  activeEngine = engine;
}
