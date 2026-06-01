-- AlterEnum
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ROOM_ACCESS_REQUESTED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ROOM_ACCESS_APPROVED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ROOM_ACCESS_REJECTED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'PROPERTY_MANAGER_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ROOM_QR_REKEYED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ROOM_HA_AREA_RESYNCED';

-- CreateEnum
CREATE TYPE "HomeContactType" AS ENUM ('PROPERTY_MANAGER');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('ACTIVE', 'REKEYED', 'REVOKED');

-- CreateEnum
CREATE TYPE "RoomAccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELED');

-- CreateEnum
CREATE TYPE "RoomAccessApprovalKind" AS ENUM ('APPROVE', 'REJECT');

-- CreateTable
CREATE TABLE "HomeContact" (
    "id" TEXT NOT NULL,
    "homeId" INTEGER NOT NULL,
    "type" "HomeContactType" NOT NULL,
    "email" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "hubInstallId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "haAreaName" TEXT NOT NULL,
    "haAreaNameOriginal" TEXT NOT NULL,
    "qrKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "qrSecretHash" TEXT NOT NULL,
    "qrSecretCiphertext" TEXT NOT NULL,
    "status" "RoomStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomAccessRequest" (
    "id" TEXT NOT NULL,
    "hubInstallId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "homeIdSnapshot" INTEGER,
    "requestedName" TEXT NOT NULL,
    "requestedEmail" TEXT NOT NULL,
    "tenantUserId" INTEGER,
    "status" "RoomAccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomAccessApprovalToken" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" "RoomAccessApprovalKind" NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomAccessApprovalToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HomeContact_homeId_type_key" ON "HomeContact"("homeId", "type");

-- CreateIndex
CREATE INDEX "HomeContact_homeId_idx" ON "HomeContact"("homeId");

-- CreateIndex
CREATE UNIQUE INDEX "Room_hubInstallId_haAreaName_key" ON "Room"("hubInstallId", "haAreaName");

-- CreateIndex
CREATE INDEX "Room_hubInstallId_idx" ON "Room"("hubInstallId");

-- CreateIndex
CREATE INDEX "RoomAccessRequest_hubInstallId_idx" ON "RoomAccessRequest"("hubInstallId");

-- CreateIndex
CREATE INDEX "RoomAccessRequest_roomId_idx" ON "RoomAccessRequest"("roomId");

-- CreateIndex
CREATE INDEX "RoomAccessRequest_status_idx" ON "RoomAccessRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RoomAccessApprovalToken_tokenHash_key" ON "RoomAccessApprovalToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RoomAccessApprovalToken_requestId_idx" ON "RoomAccessApprovalToken"("requestId");

-- CreateIndex
CREATE INDEX "RoomAccessApprovalToken_expiresAt_idx" ON "RoomAccessApprovalToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "HomeContact" ADD CONSTRAINT "HomeContact_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_hubInstallId_fkey" FOREIGN KEY ("hubInstallId") REFERENCES "HubInstall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomAccessRequest" ADD CONSTRAINT "RoomAccessRequest_hubInstallId_fkey" FOREIGN KEY ("hubInstallId") REFERENCES "HubInstall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomAccessRequest" ADD CONSTRAINT "RoomAccessRequest_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomAccessRequest" ADD CONSTRAINT "RoomAccessRequest_tenantUserId_fkey" FOREIGN KEY ("tenantUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomAccessApprovalToken" ADD CONSTRAINT "RoomAccessApprovalToken_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "RoomAccessRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

