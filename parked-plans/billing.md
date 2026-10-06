# `#billing` — Platform Subscription & Billing with Financial Dashboards

_Status as of 2026-05-05. Plan refined in planning session; not yet started._

## Intent

Build the missing platform billing model (`PlatformPlan`,
`TenantBillingProfile`, enhanced invoicing) and comprehensive financial
dashboards for both platform admins and tenants. Keep the stub payment
engine — no real Stripe integration yet. Install recharts for
visualisations. Maps to Phase 5 of the roadmap.

---

## Current State

- `TenantSubscription` — streaming-only (NONE/BRONZE/SILVER/GOLD tiers)
- `TenantPayment` — bare (amount, currency, status, invoiceRef). No period,
  no type, no line items.
- `BookingPayment` — per-booking stub flow (hardcoded £10)
- Stub `PaymentEngine` in `src/lib/payment.ts` (pluggable interface)
- Platform payments page — flat table with 4 KPI cards
- Platform subscriptions page — attested tenants list
- Onboarding subscription chapter — "I'll pay by invoice" attestation only
- Agent cost fields on `AgentRun` + `TenantAgentBudget` — exist, no dashboard
- No charting library (analytics uses CSS bars)
- No: PlatformPlan, billing profiles, invoice generation, revenue analytics

---

## Steps

### Phase A — Schema & Data Model (foundation)

1. **`PlatformPlan` model** — name, slug (unique), description,
   priceMonthlyPence, trialDays, limits (maxMembers, maxGreens,
   includedStreamingTier), featureFlags JSON, sortOrder, active.
   Seed 3 plans: Starter (£25/mo), Standard (£50/mo), Premium (£100/mo).

2. **`TenantBillingProfile` model** — tenantId (unique), planId →
   PlatformPlan, billingContactName, billingContactEmail, billingAddress
   JSON (line1/line2/city/postcode/country), vatNumber, paymentMethod enum
   (INVOICE/DIRECT_DEBIT/CARD), billingStatus enum
   (TRIAL/ACTIVE/PAST_DUE/SUSPENDED/CANCELLED), currentPeriodStart/End,
   trialEndsAt.

3. **Extend `TenantPayment`** — add periodStart, periodEnd, type enum
   (SUBSCRIPTION/STREAMING/ADDON/CREDIT/ADJUSTMENT), billingProfileId,
   pdfUrl. Backfill existing rows as type=SUBSCRIPTION.

4. **`InvoiceLineItem` model** — paymentId → TenantPayment, description,
   quantity, unitPricePence, totalPricePence, category enum
   (PLATFORM_SUBSCRIPTION/STREAMING_TIER/BOOKING_COMMISSION/ADDON/CREDIT),
   sortOrder.

5. **Migration** via `prisma migrate dev --create-only --name
   add_platform_billing`. Hand-edit rationale header + seed plans. Backfill
   ACTIVE tenants with TRIAL billing profile on Starter plan.

### Phase B — Billing API Layer (depends on A)

6. **Plans admin API** — `GET/POST /api/admin/plans`, `PATCH
   /api/admin/plans/[id]` (PLATFORM_ADMIN). Plus public `GET /api/plans`
   for onboarding/comparison.

7. **Tenant billing profile API** — `GET/PATCH /api/billing/profile`
   (TENANT_ADMIN, own profile). Audit: `billing.profile.viewed`,
   `billing.profile.updated`.

8. **Admin billing API** — `GET/PATCH /api/admin/tenants/[id]/billing`
   (profile + history + outstanding balance, PLATFORM_ADMIN).

9. **Invoice generation** — `src/lib/billing.ts`. `generateInvoice(tenantId,
   periodStart, periodEnd)` creates TenantPayment + InvoiceLineItems.
   `POST /api/admin/billing/generate` for one/all tenants (dry-run).
   Amounts from PlatformPlan.priceMonthlyPence +
   TenantSubscription.priceMonthlyPence.

10. **Bulk generation** — `POST /api/admin/billing/generate-all` iterates
    active profiles where currentPeriodEnd ≤ now, creates invoices, advances
    period. Plus `scripts/run-billing.mjs` (HTTP pattern, mirrors
    `run-agent.mjs`).

11. **Tenant invoice endpoints** — `GET /api/billing/invoices` (paginated),
    `GET /api/billing/invoices/[id]` (with line items), `GET
    /api/billing/invoices/[id]/csv`.

12. **Financial reporting** — `GET /api/admin/reports/revenue` (MRR, ARR,
    by-plan, monthly trend, ARPT, outstanding). `GET
    /api/admin/reports/churn` (rate by month, churned list).

### Phase C — Platform Financial Dashboards (depends on B, parallel with D)

13. **Install recharts** for all chart components.

14. **Platform Finance Dashboard** at `/dashboard/platform/finance`:
    - KPI row: MRR, ARR, Active Tenants, ARPT, Outstanding Balance
    - Revenue trend line chart (12 months)
    - Revenue by plan tier (stacked bar or pie)
    - Monthly churn rate line chart
    - Outstanding invoices table
    - Recent payments table (last 20)

15. **Per-tenant billing tab** — extend
    `/dashboard/platform/tenants/[id]` with plan badge, billing status,
    payment history, "Generate invoice" + "Change plan" buttons.

16. **Agent cost dashboard** at `/dashboard/platform/costs` — total LLM
    spend, per-tenant cost table (spend vs budget cap), spend trend chart,
    model breakdown.

17. **Sidebar nav** — add "Finance" and "Agent Costs" to platform admin
    section in `layout.tsx`.

### Phase D — Tenant Billing Portal (depends on B, parallel with C)

18. **Tenant billing hub** at `/dashboard/billing` — plan card (name,
    price, limits, next billing), billing status, profile form, invoice
    history table with CSV download.

19. **Plan comparison** at `/dashboard/billing/plans` — side-by-side
    feature matrix. "Contact admin to change" CTA (no self-serve v1).

20. **Sidebar nav** — "Billing" for TENANT_ADMIN in `layout.tsx`.

### Phase E — Onboarding Integration (depends on A, parallel with C/D)

21. **Upgrade subscription chapter** — `Chapter8Subscription.tsx` becomes
    a plan picker using reusable `PlanCard`. Fetches `GET /api/plans`.
    Creates `TenantBillingProfile` with status=TRIAL.

22. **Update subscription endpoint** — accepts `planId`, creates billing
    profile. Default Starter if no selection.

### Phase F — Exports & Reporting Polish

23. **Platform CSV exports** — `/api/admin/reports/revenue?format=csv`,
    `/api/admin/billing/invoices?format=csv`,
    `/api/admin/reports/tenants?format=csv`.

24. **Tenant invoice CSV** — single invoice line items export.

---

## Key Files

### Modify
- `prisma/schema.prisma` — new models + extended TenantPayment
- `prisma/seed.ts` — seed plans
- `src/app/dashboard/layout.tsx` — Finance, Agent Costs, Billing nav
- `src/app/onboarding/chapters/Chapter8Subscription.tsx` — plan picker
- `src/app/api/onboarding/subscription/route.ts` — accept planId
- `src/app/dashboard/platform/tenants/[id]/page.tsx` — billing tab

### Create
- `prisma/migrations/YYYYMMDD_add_platform_billing/migration.sql`
- `src/lib/billing.ts` — invoice gen, MRR/ARR, helpers
- `src/app/api/admin/plans/route.ts` + `[id]/route.ts`
- `src/app/api/admin/billing/generate/route.ts`
- `src/app/api/admin/billing/invoices/route.ts`
- `src/app/api/admin/tenants/[id]/billing/route.ts`
- `src/app/api/admin/reports/revenue/route.ts`
- `src/app/api/admin/reports/churn/route.ts`
- `src/app/api/billing/profile/route.ts`
- `src/app/api/billing/invoices/route.ts` + `[id]/route.ts`
- `src/app/api/plans/route.ts`
- `src/app/dashboard/platform/finance/page.tsx`
- `src/app/dashboard/platform/costs/page.tsx`
- `src/app/dashboard/billing/page.tsx`
- `src/app/dashboard/billing/plans/page.tsx`
- `src/components/billing/` (PlanCard, RevenueChart, PlanDistribution,
  ChurnChart, InvoiceTable, BillingProfileForm)
- `scripts/run-billing.mjs`

---

## Decisions Made

- **No real payment provider** — invoices created as PENDING; admin marks
  PAID manually. Same stub-first pattern as outbound messaging.
- **Plan changes are admin-mediated** — tenants view plans but cannot
  self-serve change. Avoids proration logic before Stripe.
- **Explicit line items** — each charge is a separate `InvoiceLineItem`.
  Future ad revenue, credits, overages fit as new categories.
- **recharts** over chart.js/d3 — React-native, declarative, good Next.js
  fit, no SSR concerns in dashboard pages.
- **Agent cost dashboard included** — fields exist; visibility is cheap.
- **Billing profile paymentMethod** — INVOICE only real option in v1.
  DIRECT_DEBIT/CARD enum-reserved for Stripe phase.
- **Onboarding plan picker is soft** — defaults to Starter if no
  selection; existing attestation flow preserved as fallback.

---

## Open Considerations

1. **Proration on plan changes** — excluded from v1. Plan changes take
   effect at next billing period. Revisit when Stripe lands.
2. **PDF invoices** — `pdfUrl` field exists but no PDF generator. Defer
   to Stripe phase (generates natively). CSV is the v1 export format.
3. **Booking commission** — should the platform take a % of booking
   revenue? Defers to tenant-configurable pricing backlog item.
   `InvoiceLineItem.category = BOOKING_COMMISSION` slot is ready.

---

## Verification

1. `npx prisma validate` + `npx prisma generate` after migration
2. Seed test — 3 plans created, billing profiles backfilled
3. New tests: `billing-plans.test.ts`, `billing-profile.test.ts`,
   `billing-invoices.test.ts`, `billing-reports.test.ts`
4. `npm run build` (full type check)
5. Manual: finance dashboard + tenant billing render with seed data;
   onboarding plan picker persists; CSV downloads work
6. `npm test` — no regressions

---

## Assumptions to Re-check on Resume

- `TenantPayment` still has its current shape (id, tenantId, amount,
  currency, status, invoiceRef, createdAt, updatedAt). No other session
  has extended it.
- `TenantSubscription` still streaming-only (NONE/BRONZE/SILVER/GOLD).
- No charting library has been added in the interim.
- The onboarding subscription chapter is still the stub attestation.
- `package.json` doesn't already have recharts/chart.js.
