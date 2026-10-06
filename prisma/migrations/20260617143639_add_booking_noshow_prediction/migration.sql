-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'NO_SHOW';

-- CreateTable
CREATE TABLE "BookingNoShowPrediction" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "probability" DOUBLE PRECISION NOT NULL,
    "predictedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualNoShow" BOOLEAN,

    CONSTRAINT "BookingNoShowPrediction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingNoShowPrediction_tenantId_predictedAt_idx" ON "BookingNoShowPrediction"("tenantId", "predictedAt");

-- CreateIndex
CREATE INDEX "BookingNoShowPrediction_bookingId_idx" ON "BookingNoShowPrediction"("bookingId");

-- AddForeignKey
ALTER TABLE "BookingNoShowPrediction" ADD CONSTRAINT "BookingNoShowPrediction_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingNoShowPrediction" ADD CONSTRAINT "BookingNoShowPrediction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
