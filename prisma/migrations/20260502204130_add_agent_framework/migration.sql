-- CreateEnum
CREATE TYPE "MaintenanceActivityType" AS ENUM ('SPIKED', 'SCARIFIED', 'OVERSEEDED', 'FERTILISED', 'HERBICIDE_APPLIED', 'TOP_DRESSED', 'MOWED', 'WATERED', 'DRAINED', 'OTHER');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'RATE_LIMITED');

-- CreateEnum
CREATE TYPE "AgentAction" AS ENUM ('CREATED_TASK', 'ESCALATED_TASK', 'PRIORITY_CHANGED', 'ASSIGNED_TASK', 'CONTEXT_ADDED', 'PREDICTED_TASK', 'NO_ACTION');

-- CreateEnum
CREATE TYPE "InteractionType" AS ENUM ('CREATED', 'PRIORITY_CHANGED', 'CONTEXT_ADDED', 'ASSIGNED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "ValidityFeedback" AS ENUM ('CORRECT', 'INCORRECT');

-- CreateEnum
CREATE TYPE "PriorityFeedback" AS ENUM ('CORRECT', 'TOO_HIGH', 'TOO_LOW');

-- CreateEnum
CREATE TYPE "AssignmentFeedback" AS ENUM ('CORRECT', 'WRONG_PERSON');

-- CreateEnum
CREATE TYPE "KnowledgeScope" AS ENUM ('GLOBAL', 'REGIONAL', 'TENANT');

-- CreateEnum
CREATE TYPE "KnowledgeSource" AS ENUM ('SEEDED', 'MANUAL', 'LEARNED');

-- CreateEnum
CREATE TYPE "SentimentTrend" AS ENUM ('IMPROVING', 'STABLE', 'DECLINING');

-- AlterEnum
ALTER TYPE "TaskCategory" ADD VALUE 'PREVENTIVE';

-- CreateTable
CREATE TABLE "MaintenanceHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "greenId" TEXT,
    "activityType" "MaintenanceActivityType" NOT NULL,
    "description" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "performedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDefinition" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "systemUserId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "summary" TEXT,
    "error" TEXT,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDecision" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "action" "AgentAction" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reasoning" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "taskId" TEXT,
    "previousPriority" "TaskPriority",
    "newPriority" "TaskPriority",
    "assignedToId" TEXT,
    "contextAdded" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentFeedback" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "validityFeedback" "ValidityFeedback",
    "priorityFeedback" "PriorityFeedback",
    "assignmentFeedback" "AssignmentFeedback",
    "note" TEXT,
    "givenById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMemory" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentConfig" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentKnowledge" (
    "id" TEXT NOT NULL,
    "agentId" TEXT,
    "scope" "KnowledgeScope" NOT NULL,
    "tenantId" TEXT,
    "region" TEXT,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source" "KnowledgeSource" NOT NULL DEFAULT 'MANUAL',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentKnowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAgentInteraction" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "interactionType" "InteractionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAgentInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentConfidenceMetrics" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "feedbackRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positiveFeedbackRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "historyCompleteness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taskResolutionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "averageResolutionDays" DOUBLE PRECISION,
    "dataQualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastCalculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentConfidenceMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SentimentSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "facilityScore" DOUBLE PRECISION NOT NULL,
    "messageCount" INTEGER NOT NULL,
    "topComplaints" TEXT,
    "trend" "SentimentTrend" NOT NULL DEFAULT 'STABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentimentSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenanceHistory_tenantId_performedAt_idx" ON "MaintenanceHistory"("tenantId", "performedAt");

-- CreateIndex
CREATE INDEX "MaintenanceHistory_greenId_performedAt_idx" ON "MaintenanceHistory"("greenId", "performedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentDefinition_slug_key" ON "AgentDefinition"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "AgentDefinition_systemUserId_key" ON "AgentDefinition"("systemUserId");

-- CreateIndex
CREATE INDEX "AgentRun_tenantId_startedAt_idx" ON "AgentRun"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentRun_agentId_startedAt_idx" ON "AgentRun"("agentId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentDecision_tenantId_createdAt_idx" ON "AgentDecision"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentDecision_agentId_createdAt_idx" ON "AgentDecision"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentDecision_taskId_idx" ON "AgentDecision"("taskId");

-- CreateIndex
CREATE INDEX "AgentDecision_sourceMessageId_idx" ON "AgentDecision"("sourceMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentFeedback_decisionId_key" ON "AgentFeedback"("decisionId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMemory_agentId_tenantId_key_key" ON "AgentMemory"("agentId", "tenantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "AgentConfig_agentId_tenantId_key" ON "AgentConfig"("agentId", "tenantId");

-- CreateIndex
CREATE INDEX "AgentKnowledge_scope_category_idx" ON "AgentKnowledge"("scope", "category");

-- CreateIndex
CREATE INDEX "AgentKnowledge_tenantId_idx" ON "AgentKnowledge"("tenantId");

-- CreateIndex
CREATE INDEX "TaskAgentInteraction_taskId_createdAt_idx" ON "TaskAgentInteraction"("taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentConfidenceMetrics_agentId_tenantId_key" ON "AgentConfidenceMetrics"("agentId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SentimentSnapshot_tenantId_period_key" ON "SentimentSnapshot"("tenantId", "period");

-- AddForeignKey
ALTER TABLE "MaintenanceHistory" ADD CONSTRAINT "MaintenanceHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceHistory" ADD CONSTRAINT "MaintenanceHistory_greenId_fkey" FOREIGN KEY ("greenId") REFERENCES "Green"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceHistory" ADD CONSTRAINT "MaintenanceHistory_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDefinition" ADD CONSTRAINT "AgentDefinition_systemUserId_fkey" FOREIGN KEY ("systemUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentFeedback" ADD CONSTRAINT "AgentFeedback_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "AgentDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentFeedback" ADD CONSTRAINT "AgentFeedback_givenById_fkey" FOREIGN KEY ("givenById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConfig" ADD CONSTRAINT "AgentConfig_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConfig" ADD CONSTRAINT "AgentConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentKnowledge" ADD CONSTRAINT "AgentKnowledge_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentKnowledge" ADD CONSTRAINT "AgentKnowledge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentKnowledge" ADD CONSTRAINT "AgentKnowledge_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAgentInteraction" ADD CONSTRAINT "TaskAgentInteraction_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "MaintenanceTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAgentInteraction" ADD CONSTRAINT "TaskAgentInteraction_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "AgentDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConfidenceMetrics" ADD CONSTRAINT "AgentConfidenceMetrics_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConfidenceMetrics" ADD CONSTRAINT "AgentConfidenceMetrics_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentimentSnapshot" ADD CONSTRAINT "SentimentSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
