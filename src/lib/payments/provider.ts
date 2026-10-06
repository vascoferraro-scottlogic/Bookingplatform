export type PaymentResultStatus = "PAID" | "PENDING" | "FAILED";

export interface CreateCheckoutResult {
  checkoutUrl?: string;
  providerSessionId?: string;
}

export interface ChargeResult {
  status: PaymentResultStatus;
  providerId?: string;
  message?: string;
}

export interface RefundResult {
  success: boolean;
  providerId?: string;
}

export interface PaymentProvider {
  createBookingCheckout(bookingPaymentId: string, amount: number, currency?: string): Promise<CreateCheckoutResult>;
  chargeTenantPayment(tenantPaymentId: string): Promise<ChargeResult>;
  handleWebhookEvent(body: any, headers?: Record<string, string | string[]>): Promise<void>;
  refundPayment(paymentId: string, amount?: number): Promise<RefundResult>;
}
