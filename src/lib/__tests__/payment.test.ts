import {
  stubPaymentEngine,
  setNextCheckoutOutcome,
  setNextRefundOutcome,
  resetOutcomes,
} from "@/lib/payment";

beforeEach(() => {
  resetOutcomes();
});

// ── Checkout: success ─────────────────────────────────────

test("checkout succeeds by default", async () => {
  const result = await stubPaymentEngine.createCheckout({
    amount: 1000, currency: "GBP", bookingId: "b1", returnUrl: "http://localhost/ok",
  });
  expect(result.success).toBe(true);
  expect(result.checkoutUrl).toContain("b1");
});

test("checkout success includes return URL base", async () => {
  const result = await stubPaymentEngine.createCheckout({
    amount: 500, currency: "GBP", bookingId: "b2", returnUrl: "http://example.com/done",
  });
  expect(result.checkoutUrl).toContain("http://example.com/done");
});

// ── Checkout: decline ─────────────────────────────────────

test("checkout declines when set", async () => {
  setNextCheckoutOutcome("decline");
  const result = await stubPaymentEngine.createCheckout({
    amount: 1000, currency: "GBP", bookingId: "b3", returnUrl: "http://localhost/ok",
  });
  expect(result.success).toBe(false);
  expect(result.error).toBe("Card declined");
});

// ── Checkout: insufficient funds ──────────────────────────

test("checkout fails with insufficient funds", async () => {
  setNextCheckoutOutcome("insufficient_funds");
  const result = await stubPaymentEngine.createCheckout({
    amount: 1000, currency: "GBP", bookingId: "b4", returnUrl: "http://localhost/ok",
  });
  expect(result.success).toBe(false);
  expect(result.error).toBe("Insufficient funds");
});

// ── Checkout: expired card ────────────────────────────────

test("checkout fails with expired card", async () => {
  setNextCheckoutOutcome("expired_card");
  const result = await stubPaymentEngine.createCheckout({
    amount: 1000, currency: "GBP", bookingId: "b5", returnUrl: "http://localhost/ok",
  });
  expect(result.success).toBe(false);
  expect(result.error).toBe("Card expired");
});

// ── Checkout: network error ───────────────────────────────

test("checkout fails with network error", async () => {
  setNextCheckoutOutcome("network_error");
  const result = await stubPaymentEngine.createCheckout({
    amount: 1000, currency: "GBP", bookingId: "b6", returnUrl: "http://localhost/ok",
  });
  expect(result.success).toBe(false);
  expect(result.error).toContain("Network error");
});

// ── Checkout: auto-reset after failure ────────────────────

test("checkout auto-resets to success after decline", async () => {
  setNextCheckoutOutcome("decline");
  await stubPaymentEngine.createCheckout({ amount: 100, currency: "GBP", bookingId: "b7", returnUrl: "http://localhost/ok" });
  const secondResult = await stubPaymentEngine.createCheckout({ amount: 100, currency: "GBP", bookingId: "b8", returnUrl: "http://localhost/ok" });
  expect(secondResult.success).toBe(true);
});

// ── Refund: success ───────────────────────────────────────

test("refund succeeds by default", async () => {
  const result = await stubPaymentEngine.refund({ paymentId: "p1", amount: 1000 });
  expect(result.success).toBe(true);
});

// ── Refund: decline ───────────────────────────────────────

test("refund declines when set", async () => {
  setNextRefundOutcome("decline");
  const result = await stubPaymentEngine.refund({ paymentId: "p2", amount: 1000 });
  expect(result.success).toBe(false);
  expect(result.error).toBe("Card declined");
});

// ── Refund: insufficient funds ────────────────────────────

test("refund fails with insufficient funds", async () => {
  setNextRefundOutcome("insufficient_funds");
  const result = await stubPaymentEngine.refund({ paymentId: "p3", amount: 1000 });
  expect(result.success).toBe(false);
  expect(result.error).toBe("Insufficient funds");
});

// ── Refund: expired card ──────────────────────────────────

test("refund fails with expired card", async () => {
  setNextRefundOutcome("expired_card");
  const result = await stubPaymentEngine.refund({ paymentId: "p4", amount: 1000 });
  expect(result.success).toBe(false);
  expect(result.error).toBe("Card expired");
});

// ── Refund: network error ─────────────────────────────────

test("refund fails with network error", async () => {
  setNextRefundOutcome("network_error");
  const result = await stubPaymentEngine.refund({ paymentId: "p5", amount: 1000 });
  expect(result.success).toBe(false);
  expect(result.error).toContain("Network error");
});

// ── Refund: auto-reset after failure ──────────────────────

test("refund auto-resets to success after failure", async () => {
  setNextRefundOutcome("network_error");
  await stubPaymentEngine.refund({ paymentId: "p6", amount: 1000 });
  const secondResult = await stubPaymentEngine.refund({ paymentId: "p7", amount: 1000 });
  expect(secondResult.success).toBe(true);
});

// ── Engine swap ───────────────────────────────────────────

test("resetOutcomes restores both to success", async () => {
  setNextCheckoutOutcome("decline");
  setNextRefundOutcome("expired_card");
  resetOutcomes();
  const checkout = await stubPaymentEngine.createCheckout({ amount: 100, currency: "GBP", bookingId: "b9", returnUrl: "http://localhost/ok" });
  const refund = await stubPaymentEngine.refund({ paymentId: "p8", amount: 100 });
  expect(checkout.success).toBe(true);
  expect(refund.success).toBe(true);
});
