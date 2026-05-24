-- Phase 12: boiler efficiency band + thermal-state kWh estimate snapshots.

ALTER TABLE "Device"
ADD COLUMN IF NOT EXISTS "boilerEfficiencyBand" TEXT;

ALTER TABLE "BoilerUsageAccumulator"
ADD COLUMN IF NOT EXISTS "efficiencyWeightedOnSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "efficiencyOnSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "lastSnapshotEfficiencyWeightedOnSeconds" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "lastSnapshotEfficiencyOnSeconds" INTEGER;

ALTER TABLE "BoilerTemperatureReading"
ADD COLUMN IF NOT EXISTS "averageEfficiencyPercent" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "kwhOnEstimated" DOUBLE PRECISION;

