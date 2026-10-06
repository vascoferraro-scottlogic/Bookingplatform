-- Add booking-on-behalf and admin-override fields to Booking.

ALTER TABLE "Booking" ADD COLUMN "bookedByUserId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "adminOverride" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Booking" ADD COLUMN "overrideReason" TEXT;

-- Backfill: existing bookings were all self-booked.
UPDATE "Booking" SET "bookedByUserId" = "userId" WHERE "bookedByUserId" IS NULL;

-- Index on bookedByUserId for lookups.
CREATE INDEX "Booking_bookedByUserId_idx" ON "Booking"("bookedByUserId");

-- FK constraint.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_bookedByUserId_fkey"
  FOREIGN KEY ("bookedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
