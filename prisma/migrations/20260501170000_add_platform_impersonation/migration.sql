-- AlterTable: extend AuditEvent with impersonation context
ALTER TABLE "AuditEvent"
  ADD COLUMN "actingAsTenantId" TEXT,
  ADD COLUMN "actingAsRole"     "Role",
  ADD COLUMN "impersonationId"  TEXT;

-- CreateTable
CREATE TABLE "Impersonation" (
    "id"             TEXT        NOT NULL,
    "platformUserId" TEXT        NOT NULL,
    "tenantId"       TEXT        NOT NULL,
    "assumedRole"    "Role"      NOT NULL DEFAULT 'TENANT_ADMIN',
    "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt"        TIMESTAMP(3),
    "reason"         TEXT,

    CONSTRAINT "Impersonation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Impersonation_platformUserId_startedAt_idx" ON "Impersonation"("platformUserId", "startedAt");
CREATE INDEX "Impersonation_tenantId_startedAt_idx"       ON "Impersonation"("tenantId", "startedAt");
CREATE INDEX "AuditEvent_impersonationId_idx"             ON "AuditEvent"("impersonationId");

-- AddForeignKey
ALTER TABLE "Impersonation"
  ADD CONSTRAINT "Impersonation_platformUserId_fkey"
  FOREIGN KEY ("platformUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Impersonation"
  ADD CONSTRAINT "Impersonation_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
