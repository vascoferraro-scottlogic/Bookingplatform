Payment Stub (development)
==========================

Purpose
-------
This repository includes a lightweight, development-only "payments stub" provider to simulate payment provider behaviour for local testing without integrating a real gateway.

How to enable
--------------
By default the app uses the stub in non-production. To override or configure the stub, set the following environment variables (see `.env.example`):

- `PAYMENT_PROVIDER=stub`
- `PAYMENT_STUB_MODE=immediate|webhook|manual` (default: `immediate`)
- `PAYMENT_STUB_SECRET` — optional secret for webhook authentication
- `PAYMENT_STUB_WEBHOOK_BASE` — URL the stub will post webhooks to (default: `http://localhost:3000`)
- `ALLOW_STUB_IN_PROD` — must be set to `true` to allow stub in production (not recommended)

Modes
-----
- immediate: charges are applied immediately and invoices/bookings are marked `PAID` synchronously. Use this for fast local feedback.
- webhook: provider returns `PENDING` and posts a simulated webhook to `/api/payments/webhook` after a short delay. Use this to exercise asynchronous reconciliation.
- manual: provider does not auto-action; use the admin `POST /api/payments/simulate` endpoint to inject events.

Developer scripts
-----------------
- `scripts/run-billing.mjs` — triggers invoice generation against the running app. Use `--trigger-webhook` to post simulated webhook events for each created invoice.

Examples
--------
Generate invoices and trigger webhooks (dev):

```bash
AGENT_SECRET=$AGENT_SECRET node scripts/run-billing.mjs --trigger-webhook
```

Simulate a single webhook event (local):

```bash
curl -X POST http://localhost:3000/api/payments/webhook \
  -H 'Content-Type: application/json' \
  -d '{"type":"payment_succeeded","paymentId":"<tenantPaymentId>"}'
```

Admin simulate endpoint
------------------------
Platform admins can POST to `/api/payments/simulate` (JSON body with `type` and `paymentId`) to inject events while authenticated.

Security notes
--------------
The stub is intended for development and testing only. Do not enable it in production unless you fully understand the security consequences and set `ALLOW_STUB_IN_PROD=true` and a secure `PAYMENT_STUB_SECRET`.

Where to look in code
---------------------
- Provider interface: `src/lib/payments/provider.ts`
- Stub provider: `src/lib/payments/stub.ts`
- Billing wiring: `src/lib/billing.ts`
- Booking adapter: `src/lib/payment.ts` (uses provider adapter)
- Webhook endpoint: `src/app/api/payments/webhook/route.ts`
- Admin simulate: `src/app/api/payments/simulate/route.ts`
