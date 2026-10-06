-- Onboarding KYC: capture organisation type + jurisdiction + financial year
-- end during the onboarding wizard (new Chapter 2 'Your organisation').
--
-- See plan: /memories/session/plan.md (Onboarding KYC)
-- See decisions log: 2026-05-04 (country self-declared in onboarding —
--   reverses 2026-05-03 platform-admin-only); 2026-05-04 (UK-focused
--   OrganisationType taxonomy); 2026-05-04 (FY end lifted to Tenant).
--
-- Schema diff is purely additive. The only data step is the backfill of
-- existing OnboardingProgress rows to schemaVersion=1, which signals the
-- progress GET handler to run a one-shot, idempotent shift of any
-- completedChapters entries ≥ 2 up by 1 (because we inserted a new chapter
-- at slot 2). New rows get schemaVersion=2 by default and skip the shift.
-- See decisions log 2026-05-04 (chapter renumber strategy).

-- CreateEnum
CREATE TYPE "OrganisationType" AS ENUM ('REGISTERED_CHARITY', 'CIO', 'SCIO', 'CASC', 'COMMUNITY_INTEREST_COMPANY', 'LIMITED_COMPANY', 'UNINCORPORATED_ASSOCIATION', 'PRIVATE_MEMBERS_CLUB', 'OTHER', 'NOT_CONSTITUTED');

-- AlterTable
ALTER TABLE "OnboardingProgress" ADD COLUMN     "schemaVersion" INTEGER NOT NULL DEFAULT 2;

-- Backfill: existing rows were created under v1 chapter numbering. Mark them
-- so the GET handler knows to run the shift on next access.
UPDATE "OnboardingProgress" SET "schemaVersion" = 1;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "financialYearEndDay" INTEGER,
ADD COLUMN     "financialYearEndMonth" INTEGER,
ADD COLUMN     "organisationType" "OrganisationType";
