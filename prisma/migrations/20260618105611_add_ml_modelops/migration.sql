-- CreateEnum
CREATE TYPE "MlModelStatus" AS ENUM ('TRAINING', 'TRAINED', 'ACTIVE', 'ARCHIVED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "MlFeatureStatus" AS ENUM ('AVAILABLE', 'ENROLLED', 'RETIRED');

-- CreateEnum
CREATE TYPE "MlFeatureKind" AS ENUM ('NUMERIC', 'CATEGORICAL');

-- CreateEnum
CREATE TYPE "MlDriftStatus" AS ENUM ('HEALTHY', 'WARN', 'DRIFT');

-- CreateTable
CREATE TABLE "MlModelVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "MlModelStatus" NOT NULL DEFAULT 'TRAINING',
    "artifactPath" TEXT,
    "trainedAt" TIMESTAMP(3),
    "promotedAt" TIMESTAMP(3),
    "rowsTotal" INTEGER,
    "rowsTrain" INTEGER,
    "rowsTest" INTEGER,
    "labelRate" DOUBLE PRECISION,
    "rocAuc" DOUBLE PRECISION,
    "averagePrecision" DOUBLE PRECISION,
    "brier" DOUBLE PRECISION,
    "precision" DOUBLE PRECISION,
    "recall" DOUBLE PRECISION,
    "f1" DOUBLE PRECISION,
    "threshold" DOUBLE PRECISION,
    "featureSet" TEXT,
    "coefficients" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MlModelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MlFeatureDefinition" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "MlFeatureKind" NOT NULL,
    "status" "MlFeatureStatus" NOT NULL DEFAULT 'AVAILABLE',
    "description" TEXT,
    "enrolledAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "addedInVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MlFeatureDefinition_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "MlDriftCheck" (
    "id" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "rocAuc" DOUBLE PRECISION,
    "calibrationError" DOUBLE PRECISION,
    "positiveRate" DOUBLE PRECISION,
    "deltaRocAuc" DOUBLE PRECISION,
    "deltaCalibration" DOUBLE PRECISION,
    "status" "MlDriftStatus" NOT NULL,

    CONSTRAINT "MlDriftCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MlModelVersion_version_key" ON "MlModelVersion"("version");

-- CreateIndex
CREATE INDEX "MlModelVersion_status_idx" ON "MlModelVersion"("status");

-- CreateIndex
CREATE INDEX "MlDriftCheck_modelVersion_checkedAt_idx" ON "MlDriftCheck"("modelVersion", "checkedAt");

-- CreateIndex
CREATE INDEX "MlDriftCheck_status_checkedAt_idx" ON "MlDriftCheck"("status", "checkedAt");

-- AddForeignKey
ALTER TABLE "MlDriftCheck" ADD CONSTRAINT "MlDriftCheck_modelVersion_fkey" FOREIGN KEY ("modelVersion") REFERENCES "MlModelVersion"("version") ON DELETE RESTRICT ON UPDATE CASCADE;
