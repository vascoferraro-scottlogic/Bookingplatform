-- CreateTable
CREATE TABLE "OnboardingProgress" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "currentChapter" INTEGER NOT NULL DEFAULT 1,
    "completedChapters" TEXT NOT NULL DEFAULT '[]',
    "completedAt" TIMESTAMP(3),
    "lastAnswerAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingProgress_tenantId_key" ON "OnboardingProgress"("tenantId");

-- AddForeignKey
ALTER TABLE "OnboardingProgress" ADD CONSTRAINT "OnboardingProgress_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: any existing tenants in ONBOARDING status get a progress row at chapter 1.
-- ACTIVE tenants are considered already-onboarded and get a completed row so they don't
-- get hijacked into the wizard if they happen to log in as TENANT_ADMIN.
INSERT INTO "OnboardingProgress" ("id", "tenantId", "currentChapter", "completedChapters", "completedAt", "lastAnswerAt", "createdAt", "updatedAt")
SELECT
  'ob_' || substr(md5(random()::text || t.id), 1, 24),
  t.id,
  CASE WHEN t.status = 'ACTIVE' THEN 8 ELSE 1 END,
  CASE WHEN t.status = 'ACTIVE' THEN '[1,2,3,4,5,6,7,8]' ELSE '[]' END,
  CASE WHEN t.status = 'ACTIVE' THEN t."createdAt" ELSE NULL END,
  NULL,
  NOW(),
  NOW()
FROM "Tenant" t
WHERE NOT EXISTS (SELECT 1 FROM "OnboardingProgress" op WHERE op."tenantId" = t.id);
