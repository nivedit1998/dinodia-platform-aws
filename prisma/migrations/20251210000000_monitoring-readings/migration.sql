-- CreateTable
CREATE TABLE "MonitoringReading" (
    "id" SERIAL NOT NULL,
    "haConnectionId" INTEGER NOT NULL,
    "entityId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "numericValue" DOUBLE PRECISION,
    "unit" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonitoringReading_haConnectionId_entityId_capturedAt_idx" ON "MonitoringReading"("haConnectionId", "entityId", "capturedAt");

-- AddForeignKey
ALTER TABLE "MonitoringReading" ADD CONSTRAINT "MonitoringReading_haConnectionId_fkey" FOREIGN KEY ("haConnectionId") REFERENCES "HaConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
