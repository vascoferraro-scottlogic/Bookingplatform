-- CreateEnum
CREATE TYPE "AgentScope" AS ENUM ('TENANT', 'PLATFORM', 'USER', 'FEDERATION');

-- CreateEnum
CREATE TYPE "AgentLlmUsage" AS ENUM ('ALWAYS', 'SUMMARY_ONLY', 'NEVER');

-- CreateEnum
CREATE TYPE "AgentProposalAudience" AS ENUM ('TENANT', 'PLATFORM', 'USER', 'FEDERATION');

-- CreateEnum
CREATE TYPE "AgentProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AgentRunMode" AS ENUM ('SCHEDULED', 'MANUAL', 'TRIGGERED');

-- DropForeignKey
ALTER TABLE "AgentDecision" DROP CONSTRAINT "AgentDecision_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "AgentRun" DROP CONSTRAINT "AgentRun_tenantId_fkey";

-- AlterTable
ALTER TABLE "AgentDecision" ADD COLUMN     "proposalId" TEXT,
ALTER COLUMN "tenantId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "AgentDefinition" ADD COLUMN     "preferredModel" TEXT,
ADD COLUMN     "scope" "AgentScope" NOT NULL DEFAULT 'TENANT',
ADD COLUMN     "usesLLM" "AgentLlmUsage" NOT NULL DEFAULT 'ALWAYS';

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "costsCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "federationId" TEXT,
ADD COLUMN     "mode" "AgentRunMode" NOT NULL DEFAULT 'SCHEDULED',
ADD COLUMN     "model" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "scope" "AgentScope" NOT NULL DEFAULT 'TENANT',
ADD COLUMN     "tokensIn" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tokensOut" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "traceJson" TEXT,
ADD COLUMN     "userId" TEXT,
ALTER COLUMN "tenantId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AgentProposal" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reasoning" TEXT NOT NULL,
    "audienceScope" "AgentProposalAudience" NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "federationId" TEXT,
    "targetTenantId" TEXT,
    "status" "AgentProposalStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "committedAt" TIMESTAMP(3),
    "committedById" TEXT,
    "committedEntityType" TEXT,
    "committedEntityId" TEXT,
    "committedPayloadDiff" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantAgentBudget" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "monthlyCapCents" INTEGER NOT NULL DEFAULT 0,
    "currentSpendCents" INTEGER NOT NULL DEFAULT 0,
    "cappedUntil" TIMESTAMP(3),
    "resetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantAgentBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentProposal_audienceScope_status_createdAt_idx" ON "AgentProposal"("audienceScope", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentProposal_tenantId_status_createdAt_idx" ON "AgentProposal"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentProposal_userId_status_createdAt_idx" ON "AgentProposal"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentProposal_targetTenantId_idx" ON "AgentProposal"("targetTenantId");

-- CreateIndex
CREATE INDEX "AgentProposal_agentId_kind_createdAt_idx" ON "AgentProposal"("agentId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "AgentProposal_runId_idx" ON "AgentProposal"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantAgentBudget_tenantId_key" ON "TenantAgentBudget"("tenantId");

-- CreateIndex
CREATE INDEX "AgentDecision_proposalId_idx" ON "AgentDecision"("proposalId");

-- CreateIndex
CREATE INDEX "AgentRun_userId_startedAt_idx" ON "AgentRun"("userId", "startedAt");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "AgentProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentProposal" ADD CONSTRAINT "AgentProposal_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentProposal" ADD CONSTRAINT "AgentProposal_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentProposal" ADD CONSTRAINT "AgentProposal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAgentBudget" ADD CONSTRAINT "TenantAgentBudget_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
