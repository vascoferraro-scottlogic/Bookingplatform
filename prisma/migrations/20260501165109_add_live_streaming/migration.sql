-- CreateEnum
CREATE TYPE "StreamingTier" AS ENUM ('NONE', 'BRONZE', 'SILVER', 'GOLD');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StreamStatus" AS ENUM ('IDLE', 'LIVE', 'ENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StreamVisibility" AS ENUM ('MEMBERS_ONLY', 'PUBLIC');

-- CreateEnum
CREATE TYPE "StreamAccessMethod" AS ENUM ('AUTHENTICATED', 'TOKEN_LINK');

-- CreateTable
CREATE TABLE "TenantSubscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tier" "StreamingTier" NOT NULL DEFAULT 'NONE',
    "maxConcurrentStreams" INTEGER NOT NULL DEFAULT 0,
    "archiveRetentionDays" INTEGER NOT NULL DEFAULT 0,
    "priceMonthlyPence" INTEGER NOT NULL DEFAULT 0,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "activeSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreamSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rinkId" TEXT NOT NULL,
    "eventId" TEXT,
    "title" TEXT NOT NULL,
    "status" "StreamStatus" NOT NULL DEFAULT 'IDLE',
    "visibility" "StreamVisibility" NOT NULL DEFAULT 'MEMBERS_ONLY',
    "streamKey" TEXT NOT NULL,
    "archiveUrl" TEXT,
    "thumbnailUrl" TEXT,
    "createdById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StreamSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreamViewer" (
    "id" TEXT NOT NULL,
    "streamSessionId" TEXT NOT NULL,
    "userId" TEXT,
    "sessionFingerprint" TEXT NOT NULL,
    "accessMethod" "StreamAccessMethod" NOT NULL DEFAULT 'AUTHENTICATED',
    "tokenId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,

    CONSTRAINT "StreamViewer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreamToken" (
    "id" TEXT NOT NULL,
    "streamSessionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreamToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantSubscription_tenantId_key" ON "TenantSubscription"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "StreamSession_streamKey_key" ON "StreamSession"("streamKey");

-- CreateIndex
CREATE INDEX "StreamSession_tenantId_status_idx" ON "StreamSession"("tenantId", "status");

-- CreateIndex
CREATE INDEX "StreamSession_rinkId_status_idx" ON "StreamSession"("rinkId", "status");

-- CreateIndex
CREATE INDEX "StreamViewer_streamSessionId_joinedAt_idx" ON "StreamViewer"("streamSessionId", "joinedAt");

-- CreateIndex
CREATE INDEX "StreamViewer_userId_idx" ON "StreamViewer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StreamToken_token_key" ON "StreamToken"("token");

-- CreateIndex
CREATE INDEX "StreamToken_token_idx" ON "StreamToken"("token");

-- AddForeignKey
ALTER TABLE "TenantSubscription" ADD CONSTRAINT "TenantSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamSession" ADD CONSTRAINT "StreamSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamSession" ADD CONSTRAINT "StreamSession_rinkId_fkey" FOREIGN KEY ("rinkId") REFERENCES "Rink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamSession" ADD CONSTRAINT "StreamSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamSession" ADD CONSTRAINT "StreamSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamViewer" ADD CONSTRAINT "StreamViewer_streamSessionId_fkey" FOREIGN KEY ("streamSessionId") REFERENCES "StreamSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamViewer" ADD CONSTRAINT "StreamViewer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamToken" ADD CONSTRAINT "StreamToken_streamSessionId_fkey" FOREIGN KEY ("streamSessionId") REFERENCES "StreamSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamToken" ADD CONSTRAINT "StreamToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamToken" ADD CONSTRAINT "StreamToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
