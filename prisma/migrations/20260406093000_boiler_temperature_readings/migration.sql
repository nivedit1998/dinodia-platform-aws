CREATE TABLE "BoilerTemperatureReading" (
    "id" SERIAL NOT NULL,
    "haConnectionId" INTEGER NOT NULL,
    "entityId" TEXT NOT NULL,
    "numericValue" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '°C',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoilerTemperatureReading_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BoilerTemperatureReading_haConnectionId_entityId_capturedAt_idx"
ON "BoilerTemperatureReading"("haConnectionId", "entityId", "capturedAt");

CREATE INDEX "BoilerTemperatureReading_haConnectionId_capturedAt_idx"
ON "BoilerTemperatureReading"("haConnectionId", "capturedAt");

ALTER TABLE "BoilerTemperatureReading"
ADD CONSTRAINT "BoilerTemperatureReading_haConnectionId_fkey"
FOREIGN KEY ("haConnectionId") REFERENCES "HaConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
