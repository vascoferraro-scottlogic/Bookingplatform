-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('LEAD', 'ONBOARDING', 'ACTIVE', 'SUSPENDED', 'CHURNED');

-- CreateEnum
CREATE TYPE "MembershipKind" AS ENUM ('MEMBER', 'STAFF', 'CONTRACTOR', 'VOLUNTEER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'ENDED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'MORE_INFO_REQUESTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "OutboundChannel" AS ENUM ('EMAIL', 'SMS', 'SOCIAL_POST');

-- CreateEnum
CREATE TYPE "OutboundStatus" AS ENUM ('STUBBED', 'SENT_MANUAL', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('FACEBOOK', 'TWITTER', 'INSTAGRAM');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "profession" TEXT,
ADD COLUMN     "qualifications" TEXT,
ADD COLUMN     "specialisms" TEXT;

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "kind" "MembershipKind" NOT NULL DEFAULT 'MEMBER',
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantApplication" (
    "id" TEXT NOT NULL,
    "clubName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "country" TEXT NOT NULL,
    "region" TEXT,
    "notes" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "decisionNotes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserInvitation" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'TENANT_ADMIN',
    "kind" "MembershipKind" NOT NULL DEFAULT 'STAFF',
    "invitedById" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "channel" "OutboundChannel" NOT NULL,
    "status" "OutboundStatus" NOT NULL DEFAULT 'STUBBED',
    "toAddress" TEXT NOT NULL,
    "subject" TEXT,
    "bodyText" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "template" TEXT,
    "templateData" TEXT,
    "socialPlatform" "SocialPlatform",
    "tenantId" TEXT,
    "relatedEntity" TEXT,
    "relatedEntityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Membership_tenantId_status_idx" ON "Membership"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Membership_userId_status_idx" ON "Membership"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_tenantId_key" ON "Membership"("userId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantApplication_tenantId_key" ON "TenantApplication"("tenantId");

-- CreateIndex
CREATE INDEX "TenantApplication_status_createdAt_idx" ON "TenantApplication"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TenantApplication_contactEmail_idx" ON "TenantApplication"("contactEmail");

-- CreateIndex
CREATE UNIQUE INDEX "UserInvitation_token_key" ON "UserInvitation"("token");

-- CreateIndex
CREATE INDEX "UserInvitation_email_idx" ON "UserInvitation"("email");

-- CreateIndex
CREATE INDEX "UserInvitation_tenantId_status_idx" ON "UserInvitation"("tenantId", "status");

-- CreateIndex
CREATE INDEX "OutboundMessage_channel_createdAt_idx" ON "OutboundMessage"("channel", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_tenantId_createdAt_idx" ON "OutboundMessage"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_relatedEntity_relatedEntityId_idx" ON "OutboundMessage"("relatedEntity", "relatedEntityId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantApplication" ADD CONSTRAINT "TenantApplication_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Backfill ────────────────────────────────────────────────
-- Mirror existing User.role = PLATFORM_ADMIN onto the new isPlatformAdmin flag.
UPDATE "User" SET "isPlatformAdmin" = TRUE WHERE "role" = 'PLATFORM_ADMIN';

-- Mirror existing Tenant.active onto the new status field.
-- Existing inactive tenants become SUSPENDED; active stay ACTIVE (the column default).
UPDATE "Tenant" SET "status" = 'SUSPENDED' WHERE "active" = FALSE;

-- Create a Membership row for every existing User who has a tenantId, so the
-- new code reading from Membership sees current data. Defaults: kind=MEMBER for
-- USER role, STAFF for MAINTENANCE/TENANT_ADMIN. Status mirrors User.suspended.
INSERT INTO "Membership" (
  "id", "userId", "tenantId", "role", "kind", "status",
  "startedAt", "createdAt", "updatedAt"
)
SELECT
  -- PostgreSQL doesn't have cuid; gen_random_uuid is fine for backfill ids.
  gen_random_uuid()::text,
  u."id",
  u."tenantId",
  u."role",
  CASE
    WHEN u."role" IN ('TENANT_ADMIN', 'MAINTENANCE') THEN 'STAFF'::"MembershipKind"
    ELSE 'MEMBER'::"MembershipKind"
  END,
  CASE
    WHEN u."suspended" THEN 'SUSPENDED'::"MembershipStatus"
    ELSE 'ACTIVE'::"MembershipStatus"
  END,
  u."createdAt",
  u."createdAt",
  NOW()
FROM "User" u
WHERE u."tenantId" IS NOT NULL
ON CONFLICT ("userId", "tenantId") DO NOTHING;
