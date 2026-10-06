-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "bookedByTenantId" TEXT,
ADD COLUMN     "federationId" TEXT;

-- CreateIndex
CREATE INDEX "Booking_bookedByTenantId_idx" ON "Booking"("bookedByTenantId");

-- CreateIndex
CREATE INDEX "Booking_federationId_idx" ON "Booking"("federationId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_bookedByTenantId_fkey" FOREIGN KEY ("bookedByTenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_federationId_fkey" FOREIGN KEY ("federationId") REFERENCES "Federation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
