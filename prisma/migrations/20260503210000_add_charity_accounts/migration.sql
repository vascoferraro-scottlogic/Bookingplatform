-- ─── Charity Accounts (UK/NI) ─────────────────────────────────
-- See plan: /memories/session/plan.md (P0 + P1 + P2 = MVP)
-- See decisions log: 2026-05-03 (country gate; CASC distinction; export-pack-only)

-- 1. Country enum on Tenant. PLATFORM_ADMIN-only to set; gates charity +
--    future jurisdiction-coupled features (Gift Aid, VAT/MTD, etc.).
CREATE TYPE "Country" AS ENUM ('GB', 'NI', 'OTHER');
ALTER TABLE "Tenant" ADD COLUMN "country" "Country" NOT NULL DEFAULT 'OTHER';

-- 2. Charity-domain enums.
CREATE TYPE "CharityRegulator" AS ENUM ('CC_EW', 'OSCR', 'CCNI');
CREATE TYPE "CharityCategoryKind" AS ENUM ('RECEIPT', 'PAYMENT');
CREATE TYPE "CharityFundKind" AS ENUM ('UNRESTRICTED', 'RESTRICTED', 'DESIGNATED');
CREATE TYPE "CharityFinancialYearStatus" AS ENUM ('OPEN', 'LOCKED');
CREATE TYPE "CharityTransactionSource" AS ENUM ('MANUAL', 'OCR', 'BANK_FEED');
CREATE TYPE "CharityAssetLiabilityKind" AS ENUM (
    'CASH_AT_BANK', 'INVESTMENT', 'FIXED_ASSET', 'DEBTOR', 'CREDITOR',
    'STOCK', 'OTHER_ASSET', 'OTHER_LIABILITY'
);

-- 3. CharitySettings (one per tenant).
CREATE TABLE "CharitySettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "charityNumber" TEXT,
    "regulator" "CharityRegulator" NOT NULL,
    "yearEndMonth" INTEGER NOT NULL,
    "yearEndDay" INTEGER NOT NULL,
    "reservesPolicy" TEXT,
    "publicBenefitStatement" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CharitySettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CharitySettings_tenantId_key" ON "CharitySettings"("tenantId");
ALTER TABLE "CharitySettings" ADD CONSTRAINT "CharitySettings_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. CharityFinancialYear.
CREATE TABLE "CharityFinancialYear" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "status" "CharityFinancialYearStatus" NOT NULL DEFAULT 'OPEN',
    "bankBalanceAtEnd" INTEGER,
    "lockedAt" TIMESTAMP(3),
    "lockedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CharityFinancialYear_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CharityFinancialYear_tenantId_startDate_key"
    ON "CharityFinancialYear"("tenantId", "startDate");
CREATE INDEX "CharityFinancialYear_tenantId_status_idx"
    ON "CharityFinancialYear"("tenantId", "status");
ALTER TABLE "CharityFinancialYear" ADD CONSTRAINT "CharityFinancialYear_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. CharityCategory (chart of accounts; per-tenant, regulator-seeded).
CREATE TABLE "CharityCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "CharityCategoryKind" NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CharityCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CharityCategory_tenantId_code_key"
    ON "CharityCategory"("tenantId", "code");
CREATE INDEX "CharityCategory_tenantId_kind_sortOrder_idx"
    ON "CharityCategory"("tenantId", "kind", "sortOrder");
ALTER TABLE "CharityCategory" ADD CONSTRAINT "CharityCategory_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. CharityFund.
CREATE TABLE "CharityFund" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CharityFundKind" NOT NULL DEFAULT 'UNRESTRICTED',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CharityFund_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CharityFund_tenantId_name_key"
    ON "CharityFund"("tenantId", "name");
CREATE INDEX "CharityFund_tenantId_kind_idx"
    ON "CharityFund"("tenantId", "kind");
ALTER TABLE "CharityFund" ADD CONSTRAINT "CharityFund_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. CharityTransaction.
CREATE TABLE "CharityTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "kind" "CharityCategoryKind" NOT NULL,
    "categoryId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "source" "CharityTransactionSource" NOT NULL DEFAULT 'MANUAL',
    "sourceRef" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CharityTransaction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CharityTransaction_tenantId_financialYearId_date_idx"
    ON "CharityTransaction"("tenantId", "financialYearId", "date");
CREATE INDEX "CharityTransaction_tenantId_categoryId_idx"
    ON "CharityTransaction"("tenantId", "categoryId");
CREATE INDEX "CharityTransaction_tenantId_fundId_idx"
    ON "CharityTransaction"("tenantId", "fundId");
CREATE INDEX "CharityTransaction_source_sourceRef_idx"
    ON "CharityTransaction"("source", "sourceRef");
ALTER TABLE "CharityTransaction" ADD CONSTRAINT "CharityTransaction_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CharityTransaction" ADD CONSTRAINT "CharityTransaction_financialYearId_fkey"
    FOREIGN KEY ("financialYearId") REFERENCES "CharityFinancialYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CharityTransaction" ADD CONSTRAINT "CharityTransaction_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "CharityCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CharityTransaction" ADD CONSTRAINT "CharityTransaction_fundId_fkey"
    FOREIGN KEY ("fundId") REFERENCES "CharityFund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 8. CharityAssetLiability (P2 — Statement of Assets & Liabilities lines).
CREATE TABLE "CharityAssetLiability" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "kind" "CharityAssetLiabilityKind" NOT NULL,
    "name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CharityAssetLiability_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CharityAssetLiability_tenantId_financialYearId_idx"
    ON "CharityAssetLiability"("tenantId", "financialYearId");
ALTER TABLE "CharityAssetLiability" ADD CONSTRAINT "CharityAssetLiability_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CharityAssetLiability" ADD CONSTRAINT "CharityAssetLiability_financialYearId_fkey"
    FOREIGN KEY ("financialYearId") REFERENCES "CharityFinancialYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
