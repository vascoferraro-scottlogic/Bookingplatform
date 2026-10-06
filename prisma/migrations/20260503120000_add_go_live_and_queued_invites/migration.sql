-- Add QUEUED status to InvitationStatus enum (must be added before any value is used)
ALTER TYPE "InvitationStatus" ADD VALUE 'QUEUED' BEFORE 'PENDING';

-- Tenant.goLiveAt: timestamp set when the admin presses "Go live" in the wizard
ALTER TABLE "Tenant" ADD COLUMN "goLiveAt" TIMESTAMP(3);

-- Backfill: any tenant currently ACTIVE was implicitly already live; stamp them
-- with createdAt as a best-effort go-live timestamp so the field isn't a sea of
-- NULLs for legacy data. ONBOARDING/SUSPENDED/CHURNED stay NULL.
UPDATE "Tenant" SET "goLiveAt" = "createdAt" WHERE "status" = 'ACTIVE';

-- OnboardingProgress.subscriptionAttestedAt: stub-billing self-attestation
ALTER TABLE "OnboardingProgress" ADD COLUMN "subscriptionAttestedAt" TIMESTAMP(3);

-- Backfill: any onboarding row already marked completedAt is presumed to have
-- gone through the (now-required) subscription step; stamp the same value so
-- the wizard doesn't re-prompt for already-complete tenants.
UPDATE "OnboardingProgress" SET "subscriptionAttestedAt" = "completedAt" WHERE "completedAt" IS NOT NULL;
