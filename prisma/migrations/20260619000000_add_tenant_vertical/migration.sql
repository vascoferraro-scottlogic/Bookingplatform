-- Add Vertical enum and tenant.vertical field.
-- Existing tenants backfilled to BOWLS — no behaviour change for current clubs.

CREATE TYPE "Vertical" AS ENUM ('BOWLS', 'GOLF', 'CRICKET', 'MULTI_SPORT', 'CHARITY_ADMIN', 'OTHER');

ALTER TABLE "Tenant" ADD COLUMN "vertical" "Vertical" NOT NULL DEFAULT 'BOWLS';
