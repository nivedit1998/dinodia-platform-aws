-- Phase 6: Track UNKNOWN heating usage time (telemetry gaps)

ALTER TABLE "BoilerTemperatureReading"
ADD COLUMN IF NOT EXISTS "unknownForSeconds" INTEGER;

ALTER TABLE "BoilerUsageAccumulator"
ADD COLUMN IF NOT EXISTS "unknownSeconds" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "BoilerUsageAccumulator"
ADD COLUMN IF NOT EXISTS "lastWasKnown" BOOLEAN;

ALTER TABLE "BoilerUsageAccumulator"
ADD COLUMN IF NOT EXISTS "lastSnapshotUnknownSeconds" INTEGER;

ALTER TABLE "RadiatorUsageAccumulator"
ADD COLUMN IF NOT EXISTS "unknownSeconds" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "RadiatorUsageAccumulator"
ADD COLUMN IF NOT EXISTS "lastWasKnown" BOOLEAN;

ALTER TABLE "RadiatorUsageAccumulator"
ADD COLUMN IF NOT EXISTS "lastSnapshotUnknownSeconds" INTEGER;

