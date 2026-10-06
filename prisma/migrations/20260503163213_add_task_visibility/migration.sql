-- CreateEnum
CREATE TYPE "TaskVisibility" AS ENUM ('MAINTENANCE_ONLY', 'MEMBERS', 'PUBLIC');

-- AlterTable
-- New column with default MAINTENANCE_ONLY (correct for newly-created agent-derived tasks).
ALTER TABLE "MaintenanceTask" ADD COLUMN     "visibility" "TaskVisibility" NOT NULL DEFAULT 'MAINTENANCE_ONLY';

-- Backfill: every existing task pre-dates the visibility model and was visible to
-- members under the old behaviour. Set them all to MEMBERS to preserve that.
-- See decisions log 2026-05-03 (member-message-derived tasks).
UPDATE "MaintenanceTask" SET "visibility" = 'MEMBERS';

-- CreateIndex
CREATE INDEX "MaintenanceTask_tenantId_visibility_status_idx" ON "MaintenanceTask"("tenantId", "visibility", "status");
