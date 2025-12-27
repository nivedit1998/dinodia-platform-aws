-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'STOLEN', 'BLOCKED');

-- CreateEnum
CREATE TYPE "StepUpPurpose" AS ENUM ('REMOTE_ACCESS_SETUP');

-- AlterEnum
ALTER TYPE "AuthChallengePurpose" ADD VALUE 'REMOTE_ACCESS_SETUP';

-- CreateTable
CREATE TABLE "DeviceRegistry" (
    "deviceId" TEXT NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "label" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceRegistry_pkey" PRIMARY KEY ("deviceId")
);

-- CreateTable
CREATE TABLE "StepUpApproval" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "deviceId" TEXT NOT NULL,
    "purpose" "StepUpPurpose" NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StepUpApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StepUpApproval_userId_deviceId_purpose_idx" ON "StepUpApproval"("userId", "deviceId", "purpose");

-- CreateIndex
CREATE INDEX "StepUpApproval_deviceId_idx" ON "StepUpApproval"("deviceId");

-- AddForeignKey
ALTER TABLE "StepUpApproval" ADD CONSTRAINT "StepUpApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
