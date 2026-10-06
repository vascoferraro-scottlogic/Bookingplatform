-- Migration: add_platform_billing
-- See plan: parked-plans/billing.md (Phase A)
-- See decisions log: DECISIONS.md 2026-05-05 (#billing)
--
-- Adds:
--   - PlatformPlan table (3 seed rows: Starter, Standard, Premium)
--   - TenantBillingProfile (one-to-one with Tenant, links to PlatformPlan)
--   - InvoiceLineItem (per-charge detail on TenantPayment)
--   - Extends TenantPayment with type, periodStart/End, billingProfileId, pdfUrl
--   - New enums: PaymentType, BillingPaymentMethod, BillingStatus, InvoiceLineCategory
--   - Backfills: existing TenantPayment rows get type=SUBSCRIPTION (via DEFAULT);
--     ACTIVE tenants get a TRIAL billing profile on the Starter plan.

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('SUBSCRIPTION', 'STREAMING', 'ADDON', 'CREDIT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "BillingPaymentMethod" AS ENUM ('INVOICE', 'DIRECT_DEBIT', 'CARD');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceLineCategory" AS ENUM ('PLATFORM_SUBSCRIPTION', 'STREAMING_TIER', 'BOOKING_COMMISSION', 'ADDON', 'CREDIT');

-- AlterTable
ALTER TABLE "TenantPayment" ADD COLUMN     "billingProfileId" TEXT,
ADD COLUMN     "pdfUrl" TEXT,
ADD COLUMN     "periodEnd" TIMESTAMP(3),
ADD COLUMN     "periodStart" TIMESTAMP(3),
ADD COLUMN     "type" "PaymentType" NOT NULL DEFAULT 'SUBSCRIPTION';

-- CreateTable
CREATE TABLE "PlatformPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "priceMonthlyPence" INTEGER NOT NULL,
    "trialDays" INTEGER NOT NULL DEFAULT 30,
    "maxMembers" INTEGER NOT NULL DEFAULT 50,
    "maxGreens" INTEGER NOT NULL DEFAULT 2,
    "includedStreamingTier" "StreamingTier" NOT NULL DEFAULT 'NONE',
    "featureFlags" JSONB DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantBillingProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "billingContactName" TEXT,
    "billingContactEmail" TEXT,
    "billingAddress" JSONB DEFAULT '{}',
    "vatNumber" TEXT,
    "paymentMethod" "BillingPaymentMethod" NOT NULL DEFAULT 'INVOICE',
    "billingStatus" "BillingStatus" NOT NULL DEFAULT 'TRIAL',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantBillingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLineItem" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPricePence" INTEGER NOT NULL,
    "totalPricePence" INTEGER NOT NULL,
    "category" "InvoiceLineCategory" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPlan_slug_key" ON "PlatformPlan"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "TenantBillingProfile_tenantId_key" ON "TenantBillingProfile"("tenantId");

-- CreateIndex
CREATE INDEX "TenantPayment_tenantId_status_idx" ON "TenantPayment"("tenantId", "status");

-- CreateIndex
CREATE INDEX "TenantPayment_billingProfileId_idx" ON "TenantPayment"("billingProfileId");

-- AddForeignKey
ALTER TABLE "TenantBillingProfile" ADD CONSTRAINT "TenantBillingProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantBillingProfile" ADD CONSTRAINT "TenantBillingProfile_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PlatformPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantPayment" ADD CONSTRAINT "TenantPayment_billingProfileId_fkey" FOREIGN KEY ("billingProfileId") REFERENCES "TenantBillingProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "TenantPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Seed: Platform plans ────────────────────────────────────
-- Three tiers with escalating limits. IDs are stable CUIDs for FK
-- references in the backfill below.

INSERT INTO "PlatformPlan" ("id", "name", "slug", "description", "priceMonthlyPence", "trialDays", "maxMembers", "maxGreens", "includedStreamingTier", "featureFlags", "sortOrder", "active", "createdAt", "updatedAt")
VALUES
  ('plan_starter_001', 'Starter', 'starter', 'For small clubs getting started', 2500, 30, 50, 2, 'NONE', '{"messaging": true, "events": true}', 1, true, NOW(), NOW()),
  ('plan_standard_001', 'Standard', 'standard', 'For established clubs with active membership', 5000, 30, 150, 4, 'BRONZE', '{"messaging": true, "events": true, "publicEvents": true, "publicAvailability": true, "liveStreaming": true}', 2, true, NOW(), NOW()),
  ('plan_premium_001', 'Premium', 'premium', 'For large clubs wanting the full platform', 10000, 30, 500, 10, 'GOLD', '{"messaging": true, "events": true, "publicEvents": true, "publicAvailability": true, "liveStreaming": true, "analytics": true}', 3, true, NOW(), NOW());

-- ─── Backfill: ACTIVE tenants get a TRIAL billing profile on Starter ──
-- Uses a 30-day trial starting now. Only creates profiles for tenants that
-- don't already have one (idempotent on re-run).

INSERT INTO "TenantBillingProfile" ("id", "tenantId", "planId", "billingStatus", "currentPeriodStart", "currentPeriodEnd", "trialEndsAt", "createdAt", "updatedAt")
SELECT
  'bp_' || "id",
  "id",
  'plan_starter_001',
  'TRIAL',
  NOW(),
  NOW() + INTERVAL '30 days',
  NOW() + INTERVAL '30 days',
  NOW(),
  NOW()
FROM "Tenant"
WHERE "status" = 'ACTIVE'
  AND "id" NOT IN (SELECT "tenantId" FROM "TenantBillingProfile");
