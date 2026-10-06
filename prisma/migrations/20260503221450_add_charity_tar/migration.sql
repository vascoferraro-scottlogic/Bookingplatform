-- Migration: add_charity_tar
-- Phase: P5 — Trustees' Annual Report wizard
-- Depends on: 20260503210000_add_charity_accounts (CharityFinancialYear FK)
--
-- Adds CharityTAR model (one per tenant+year) with JSON sections blob,
-- lifecycle status (DRAFT → FINALISED), and audit timestamps.

-- CreateEnum
CREATE TYPE "CharityTARStatus" AS ENUM ('DRAFT', 'FINALISED');

-- CreateTable
CREATE TABLE "CharityTAR" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "financialYearId" TEXT NOT NULL,
    "status" "CharityTARStatus" NOT NULL DEFAULT 'DRAFT',
    "sections" TEXT NOT NULL DEFAULT '{}',
    "generatedAt" TIMESTAMP(3),
    "finalisedAt" TIMESTAMP(3),
    "finalisedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharityTAR_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CharityTAR_tenantId_status_idx" ON "CharityTAR"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CharityTAR_tenantId_financialYearId_key" ON "CharityTAR"("tenantId", "financialYearId");

-- AddForeignKey
ALTER TABLE "CharityTAR" ADD CONSTRAINT "CharityTAR_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharityTAR" ADD CONSTRAINT "CharityTAR_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "CharityFinancialYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
