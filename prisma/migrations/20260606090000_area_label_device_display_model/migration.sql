-- CreateEnum
CREATE TYPE "TenantDeviceCleanupStatus" AS ENUM ('ACTIVE', 'PENDING_DEVICE_CLEANUP', 'CLEANED_UP');

-- CreateEnum
CREATE TYPE "TenantDeviceCleanupReason" AS ENUM ('TENANT_DELETED', 'AREA_ACCESS_REMOVED', 'DEVICE_MOVE_FAILED', 'MANUAL_RETRY');

-- AlterTable
ALTER TABLE "NewDeviceCommissioningSession"
ADD COLUMN "requestedDisplayLabel" TEXT,
ADD COLUMN "requestedDisplayLabelKey" TEXT,
ADD COLUMN "requestedParentHaAreaId" TEXT,
ADD COLUMN "requestedVirtualAreaId" TEXT,
ADD COLUMN "requestedNewVirtualAreaName" TEXT,
ADD COLUMN "haTechnicalName" TEXT,
ADD COLUMN "cleanupStatus" "TenantDeviceCleanupStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "cleanupLastError" TEXT;

-- CreateTable
CREATE TABLE "AreaDisplayOverride" (
    "id" TEXT NOT NULL,
    "haConnectionId" INTEGER NOT NULL,
    "haAreaId" TEXT,
    "haAreaName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "displayKey" TEXT NOT NULL,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AreaDisplayOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelDisplayOverride" (
    "id" TEXT NOT NULL,
    "haConnectionId" INTEGER NOT NULL,
    "sourceTechnicalLabel" TEXT NOT NULL,
    "canonicalLabel" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "displayKey" TEXT NOT NULL,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabelDisplayOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantVirtualArea" (
    "id" TEXT NOT NULL,
    "tenantUserId" INTEGER NOT NULL,
    "haConnectionId" INTEGER NOT NULL,
    "parentHaAreaId" TEXT,
    "parentHaAreaName" TEXT NOT NULL,
    "parentAreaDisplaySnapshot" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "displayKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantVirtualArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantDeviceDisplayOverride" (
    "id" TEXT NOT NULL,
    "tenantUserId" INTEGER NOT NULL,
    "tenantUserIdKey" TEXT NOT NULL,
    "haConnectionId" INTEGER NOT NULL,
    "haDeviceId" TEXT,
    "entityId" TEXT,
    "displayName" TEXT NOT NULL,
    "displayNameKey" TEXT NOT NULL,
    "haTechnicalName" TEXT NOT NULL,
    "displayLabel" TEXT NOT NULL,
    "displayLabelKey" TEXT NOT NULL,
    "canonicalLabel" TEXT,
    "parentHaAreaId" TEXT,
    "parentHaAreaName" TEXT NOT NULL,
    "parentAreaDisplaySnapshot" TEXT NOT NULL,
    "tenantVirtualAreaId" TEXT,
    "cleanupStatus" "TenantDeviceCleanupStatus" NOT NULL DEFAULT 'ACTIVE',
    "cleanupReason" "TenantDeviceCleanupReason",
    "cleanupAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "cleanupLastAttemptAt" TIMESTAMP(3),
    "cleanupLastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantDeviceDisplayOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AreaDisplayOverride_haConnectionId_haAreaName_key" ON "AreaDisplayOverride"("haConnectionId", "haAreaName");

-- CreateIndex
CREATE INDEX "AreaDisplayOverride_haConnectionId_displayKey_idx" ON "AreaDisplayOverride"("haConnectionId", "displayKey");

-- CreateIndex
CREATE UNIQUE INDEX "LabelDisplayOverride_haConnectionId_sourceTechnicalLabel_key" ON "LabelDisplayOverride"("haConnectionId", "sourceTechnicalLabel");

-- CreateIndex
CREATE INDEX "LabelDisplayOverride_haConnectionId_displayKey_idx" ON "LabelDisplayOverride"("haConnectionId", "displayKey");

-- CreateIndex
CREATE UNIQUE INDEX "TenantVirtualArea_tenantUserId_haConnectionId_parentHaAreaName_displayKey_key" ON "TenantVirtualArea"("tenantUserId", "haConnectionId", "parentHaAreaName", "displayKey");

-- CreateIndex
CREATE INDEX "TenantVirtualArea_tenantUserId_haConnectionId_idx" ON "TenantVirtualArea"("tenantUserId", "haConnectionId");

-- CreateIndex
CREATE INDEX "TenantVirtualArea_haConnectionId_parentHaAreaName_idx" ON "TenantVirtualArea"("haConnectionId", "parentHaAreaName");

-- CreateIndex
CREATE UNIQUE INDEX "TenantDeviceDisplayOverride_tenantUserId_haConnectionId_displayNameKey_key" ON "TenantDeviceDisplayOverride"("tenantUserId", "haConnectionId", "displayNameKey");

-- CreateIndex
CREATE INDEX "TenantDeviceDisplayOverride_tenantUserId_haConnectionId_idx" ON "TenantDeviceDisplayOverride"("tenantUserId", "haConnectionId");

-- CreateIndex
CREATE INDEX "TenantDeviceDisplayOverride_haConnectionId_haDeviceId_idx" ON "TenantDeviceDisplayOverride"("haConnectionId", "haDeviceId");

-- CreateIndex
CREATE INDEX "TenantDeviceDisplayOverride_haConnectionId_entityId_idx" ON "TenantDeviceDisplayOverride"("haConnectionId", "entityId");

-- CreateIndex
CREATE INDEX "TenantDeviceDisplayOverride_haConnectionId_cleanupStatus_idx" ON "TenantDeviceDisplayOverride"("haConnectionId", "cleanupStatus");

-- AddForeignKey
ALTER TABLE "AreaDisplayOverride" ADD CONSTRAINT "AreaDisplayOverride_haConnectionId_fkey" FOREIGN KEY ("haConnectionId") REFERENCES "HaConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaDisplayOverride" ADD CONSTRAINT "AreaDisplayOverride_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelDisplayOverride" ADD CONSTRAINT "LabelDisplayOverride_haConnectionId_fkey" FOREIGN KEY ("haConnectionId") REFERENCES "HaConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelDisplayOverride" ADD CONSTRAINT "LabelDisplayOverride_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantVirtualArea" ADD CONSTRAINT "TenantVirtualArea_tenantUserId_fkey" FOREIGN KEY ("tenantUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantVirtualArea" ADD CONSTRAINT "TenantVirtualArea_haConnectionId_fkey" FOREIGN KEY ("haConnectionId") REFERENCES "HaConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantDeviceDisplayOverride" ADD CONSTRAINT "TenantDeviceDisplayOverride_tenantUserId_fkey" FOREIGN KEY ("tenantUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantDeviceDisplayOverride" ADD CONSTRAINT "TenantDeviceDisplayOverride_haConnectionId_fkey" FOREIGN KEY ("haConnectionId") REFERENCES "HaConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantDeviceDisplayOverride" ADD CONSTRAINT "TenantDeviceDisplayOverride_tenantVirtualAreaId_fkey" FOREIGN KEY ("tenantVirtualAreaId") REFERENCES "TenantVirtualArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;
