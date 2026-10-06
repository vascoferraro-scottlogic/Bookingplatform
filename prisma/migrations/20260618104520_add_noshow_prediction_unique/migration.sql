/*
  Warnings:

  - A unique constraint covering the columns `[bookingId,modelVersion]` on the table `BookingNoShowPrediction` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "BookingNoShowPrediction_bookingId_modelVersion_key" ON "BookingNoShowPrediction"("bookingId", "modelVersion");
