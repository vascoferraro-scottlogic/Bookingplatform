-- CreateEnum
CREATE TYPE "FundingApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PENDING_DECISION', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "FundingResponseSource" AS ENUM ('MANUAL', 'AI_DRAFT', 'AI_APPROVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Permission" ADD VALUE 'funding_view';
ALTER TYPE "Permission" ADD VALUE 'funding_manage';

-- CreateTable
CREATE TABLE "FundingOpportunity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "funder" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "url" TEXT,
    "eligibilityNotes" TEXT,
    "deadline" TIMESTAMP(3),
    "maxAmount" INTEGER,
    "minAmount" INTEGER,
    "tags" TEXT[],
    "orgTypes" "OrganisationType"[],
    "countries" "Country"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundingOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingApplication" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "status" "FundingApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "amountRequested" INTEGER,
    "amountAwarded" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "decisionAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundingApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingQuestion" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "helpText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundingQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingResponse" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "questionId" TEXT,
    "questionLabel" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "source" "FundingResponseSource" NOT NULL DEFAULT 'MANUAL',
    "agentProposalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundingResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FundingOpportunity_active_idx" ON "FundingOpportunity"("active");

-- CreateIndex
CREATE INDEX "FundingOpportunity_tenantId_idx" ON "FundingOpportunity"("tenantId");

-- CreateIndex
CREATE INDEX "FundingApplication_tenantId_idx" ON "FundingApplication"("tenantId");

-- CreateIndex
CREATE INDEX "FundingApplication_status_idx" ON "FundingApplication"("status");

-- CreateIndex
CREATE INDEX "FundingQuestion_opportunityId_idx" ON "FundingQuestion"("opportunityId");

-- CreateIndex
CREATE INDEX "FundingResponse_applicationId_idx" ON "FundingResponse"("applicationId");

-- AddForeignKey
ALTER TABLE "FundingOpportunity" ADD CONSTRAINT "FundingOpportunity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingApplication" ADD CONSTRAINT "FundingApplication_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingApplication" ADD CONSTRAINT "FundingApplication_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "FundingOpportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingApplication" ADD CONSTRAINT "FundingApplication_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingQuestion" ADD CONSTRAINT "FundingQuestion_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "FundingOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingResponse" ADD CONSTRAINT "FundingResponse_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "FundingApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingResponse" ADD CONSTRAINT "FundingResponse_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "FundingQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
