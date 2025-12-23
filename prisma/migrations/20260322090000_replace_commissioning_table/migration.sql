-- Drop old commissioning sessions table (destructive)
DROP TABLE IF EXISTS "MatterCommissioningSession" CASCADE;

-- Create new enum for commissioning kind
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissioningKind') THEN
    CREATE TYPE "CommissioningKind" AS ENUM ('MATTER', 'DISCOVERY');
  END IF;
END$$;

-- Create replacement table
CREATE TABLE "NewDeviceCommissioningSession" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "haConnectionId" INTEGER NOT NULL,
    "requestedArea" TEXT NOT NULL,
    "requestedName" TEXT,
    "requestedDinodiaType" TEXT,
    "requestedHaLabelId" TEXT,
    "setupPayloadHash" TEXT,
    "manualPairingCodeHash" TEXT,
    "haFlowId" TEXT,
    "status" "MatterCommissioningStatus" NOT NULL DEFAULT 'CREATED',
    "kind" "CommissioningKind" NOT NULL DEFAULT 'MATTER',
    "error" TEXT,
    "lastHaStep" JSONB,
    "beforeDeviceIds" JSONB,
    "beforeEntityIds" JSONB,
    "afterDeviceIds" JSONB,
    "afterEntityIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewDeviceCommissioningSession_pkey" PRIMARY KEY ("id")
);

-- Add indexes
CREATE INDEX "NewDeviceCommissioningSession_userId_idx" ON "NewDeviceCommissioningSession"("userId");
CREATE INDEX "NewDeviceCommissioningSession_haConnectionId_idx" ON "NewDeviceCommissioningSession"("haConnectionId");
CREATE INDEX "NewDeviceCommissioningSession_haFlowId_idx" ON "NewDeviceCommissioningSession"("haFlowId");
CREATE INDEX "NewDeviceCommissioningSession_kind_idx" ON "NewDeviceCommissioningSession"("kind");

-- Add foreign keys
ALTER TABLE "NewDeviceCommissioningSession" ADD CONSTRAINT "NewDeviceCommissioningSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NewDeviceCommissioningSession" ADD CONSTRAINT "NewDeviceCommissioningSession_haConnectionId_fkey" FOREIGN KEY ("haConnectionId") REFERENCES "HaConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
