-- CreateEnum
CREATE TYPE "HubTokenStatus" AS ENUM ('PENDING', 'ACTIVE', 'GRACE', 'REVOKED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'INSTALLER';

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_homeId_fkey";

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "homeId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "HubInstall" (
    "id" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "bootstrapSecretCiphertext" TEXT NOT NULL,
    "syncSecretCiphertext" TEXT,
    "platformSyncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "platformSyncIntervalMinutes" INTEGER NOT NULL DEFAULT 5,
    "rotateEveryDays" INTEGER NOT NULL DEFAULT 14,
    "graceMinutes" INTEGER NOT NULL DEFAULT 10080,
    "publishedHubTokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastAckedHubTokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "homeId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HubInstall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HubToken" (
    "id" TEXT NOT NULL,
    "hubInstallId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "HubTokenStatus" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenCiphertext" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "graceUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HubToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HubInstall_serial_key" ON "HubInstall"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "HubInstall_homeId_key" ON "HubInstall"("homeId");

-- CreateIndex
CREATE INDEX "HubToken_hubInstallId_status_idx" ON "HubToken"("hubInstallId", "status");

-- CreateIndex
CREATE INDEX "HubToken_tokenHash_idx" ON "HubToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "HubToken_hubInstallId_version_key" ON "HubToken"("hubInstallId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "HubToken_hubInstallId_tokenHash_key" ON "HubToken"("hubInstallId", "tokenHash");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HubInstall" ADD CONSTRAINT "HubInstall_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HubToken" ADD CONSTRAINT "HubToken_hubInstallId_fkey" FOREIGN KEY ("hubInstallId") REFERENCES "HubInstall"("id") ON DELETE CASCADE ON UPDATE CASCADE;
