-- Phase 5: Per-snapshot ON/OFF deltas

ALTER TABLE "BoilerTemperatureReading"
ADD COLUMN "onForSeconds" INTEGER,
ADD COLUMN "offForSeconds" INTEGER;

ALTER TABLE "BoilerUsageAccumulator"
ADD COLUMN "lastSnapshotOnSeconds" INTEGER,
ADD COLUMN "lastSnapshotOffSeconds" INTEGER,
ADD COLUMN "lastSnapshotAt" TIMESTAMP(3);

ALTER TABLE "RadiatorUsageAccumulator"
ADD COLUMN "lastSnapshotOnSeconds" INTEGER,
ADD COLUMN "lastSnapshotOffSeconds" INTEGER,
ADD COLUMN "lastSnapshotAt" TIMESTAMP(3);

