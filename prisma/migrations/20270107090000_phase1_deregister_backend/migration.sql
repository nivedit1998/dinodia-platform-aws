-- AlterEnum
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'TENANT_DELETED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'AUTOMATION_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'AUTOMATION_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'AUTOMATION_DELETED';

-- CreateEnum
CREATE TYPE "HomeAutomationSource" AS ENUM ('DINODIA_UI');

-- CreateTable
CREATE TABLE "HomeAutomation" (
    "homeId" INTEGER NOT NULL,
    "automationId" TEXT NOT NULL,
    "createdByUserId" INTEGER,
    "source" "HomeAutomationSource" NOT NULL DEFAULT 'DINODIA_UI',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeAutomation_pkey" PRIMARY KEY ("homeId","automationId")
);

-- CreateIndex
CREATE INDEX "HomeAutomation_homeId_idx" ON "HomeAutomation"("homeId");

-- CreateIndex
CREATE INDEX "HomeAutomation_createdByUserId_idx" ON "HomeAutomation"("createdByUserId");

-- AddForeignKey
ALTER TABLE "HomeAutomation" ADD CONSTRAINT "HomeAutomation_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeAutomation" ADD CONSTRAINT "HomeAutomation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
