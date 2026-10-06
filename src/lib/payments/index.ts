import type { PaymentProvider } from "./provider";
import { StubPaymentProvider } from "./stub";

const providerName = process.env.PAYMENT_PROVIDER ?? (process.env.NODE_ENV === "production" ? "noop" : "stub");

let paymentProvider: PaymentProvider;

if (providerName === "stub") {
  paymentProvider = new StubPaymentProvider();
} else {
  // For now fallback to stub in all environments. Replace with real provider wiring later.
  paymentProvider = new StubPaymentProvider();
}

export { paymentProvider };
