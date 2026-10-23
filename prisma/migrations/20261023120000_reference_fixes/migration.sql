-- Dedupe waiting-list entries (keep earliest) so the new unique index can be created.
DELETE FROM "WaitlistEntry" a USING "WaitlistEntry" b
WHERE a."bookingId" = b."bookingId" AND a."userId" = b."userId"
  AND (a."createdAt", a."id") > (b."createdAt", b."id");

ALTER TYPE "PaymentStatus" ADD VALUE 'REFUND_FAILED';

-- AlterTable
ALTER TABLE "Green" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Rink" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "bookingFeePence" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Europe/London';

-- AlterTable
ALTER TABLE "TenantApplication" ADD COLUMN     "vertical" "Vertical" NOT NULL DEFAULT 'BOWLS';

-- CreateTable
CREATE TABLE "ProcessedWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedWebhookEvent_eventId_key" ON "ProcessedWebhookEvent"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_bookingId_userId_key" ON "WaitlistEntry"("bookingId", "userId");

