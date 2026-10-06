-- AlterTable: add season columns to Green
ALTER TABLE "Green" ADD COLUMN "allWeather" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Green" ADD COLUMN "seasonStartMMDD" TEXT;
ALTER TABLE "Green" ADD COLUMN "seasonEndMMDD" TEXT;

-- CreateTable: GreenSeason (per-year overrides)
CREATE TABLE "GreenSeason" (
    "id" TEXT NOT NULL,
    "greenId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GreenSeason_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GreenSeason_greenId_year_key" ON "GreenSeason"("greenId", "year");

ALTER TABLE "GreenSeason" ADD CONSTRAINT "GreenSeason_greenId_fkey"
    FOREIGN KEY ("greenId") REFERENCES "Green"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: copy tenant-level season dates (MM-DD part) onto each green
UPDATE "Green" g
SET
    "seasonStartMMDD" = SUBSTRING(t."seasonStart" FROM 6),
    "seasonEndMMDD"   = SUBSTRING(t."seasonEnd" FROM 6)
FROM "Tenant" t
WHERE g."tenantId" = t."id"
  AND t."seasonStart" IS NOT NULL
  AND t."seasonEnd" IS NOT NULL;
