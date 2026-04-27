ALTER TABLE "BoilerTemperatureReading"
ADD COLUMN "currentTemperature" DOUBLE PRECISION,
ADD COLUMN "targetTemperature" DOUBLE PRECISION;

UPDATE "BoilerTemperatureReading"
SET "currentTemperature" = "numericValue"
WHERE "currentTemperature" IS NULL;

ALTER TABLE "BoilerTemperatureReading"
ALTER COLUMN "currentTemperature" SET NOT NULL;
