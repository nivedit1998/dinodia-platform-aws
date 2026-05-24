-- CreateTable
CREATE TABLE "BoilerUsageAccumulator" (
    "id" SERIAL NOT NULL,
    "haConnectionId" INTEGER NOT NULL,
    "entityId" TEXT NOT NULL,
    "onSeconds" INTEGER NOT NULL DEFAULT 0,
    "offSeconds" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "lastWasOn" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoilerUsageAccumulator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadiatorUsageAccumulator" (
    "id" SERIAL NOT NULL,
    "haConnectionId" INTEGER NOT NULL,
    "entityId" TEXT NOT NULL,
    "onSeconds" INTEGER NOT NULL DEFAULT 0,
    "offSeconds" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "lastWasOn" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RadiatorUsageAccumulator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BoilerUsageAccumulator_haConnectionId_entityId_key" ON "BoilerUsageAccumulator"("haConnectionId", "entityId");

-- CreateIndex
CREATE INDEX "BoilerUsageAccumulator_haConnectionId_idx" ON "BoilerUsageAccumulator"("haConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "RadiatorUsageAccumulator_haConnectionId_entityId_key" ON "RadiatorUsageAccumulator"("haConnectionId", "entityId");

-- CreateIndex
CREATE INDEX "RadiatorUsageAccumulator_haConnectionId_idx" ON "RadiatorUsageAccumulator"("haConnectionId");

-- AddForeignKey
ALTER TABLE "BoilerUsageAccumulator" ADD CONSTRAINT "BoilerUsageAccumulator_haConnectionId_fkey" FOREIGN KEY ("haConnectionId") REFERENCES "HaConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadiatorUsageAccumulator" ADD CONSTRAINT "RadiatorUsageAccumulator_haConnectionId_fkey" FOREIGN KEY ("haConnectionId") REFERENCES "HaConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

