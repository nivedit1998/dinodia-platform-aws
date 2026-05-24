-- Phase 11: store per-boiler configuration overrides on Device rows.

ALTER TABLE "Device"
ADD COLUMN IF NOT EXISTS "boilerPowerKw" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "heatingPricePerKwh" DOUBLE PRECISION;

