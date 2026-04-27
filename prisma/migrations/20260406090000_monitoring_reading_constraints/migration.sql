-- Add constraints to enforce valid MonitoringReading units
ALTER TABLE "MonitoringReading"
ADD CONSTRAINT "MonitoringReading_unit_check"
CHECK (unit IS NOT NULL AND unit IN ('kWh', '%'));

ALTER TABLE "MonitoringReading"
ADD CONSTRAINT "MonitoringReading_battery_unit_check"
CHECK (unit <> '%' OR "entityId" ILIKE '%battery%');

-- Add partial index for analytics queries
CREATE INDEX "MonitoringReading_haConnectionId_capturedAt_valid_idx"
ON "MonitoringReading" ("haConnectionId", "capturedAt")
WHERE unit IN ('kWh', '%');
