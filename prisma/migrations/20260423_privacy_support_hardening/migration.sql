-- AlterEnum
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'SUPPORT_REQUEST_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'SUPPORT_REQUEST_APPROVED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'SUPPORT_REQUEST_REVOKED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'SUPPORT_CREDENTIALS_VIEWED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'SUPPORT_IMPERSONATION_STARTED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'SUPPORT_IMPERSONATION_STOPPED';

-- AlterTable
ALTER TABLE "SupportRequest"
ADD COLUMN "approvedByUserId" INTEGER,
ADD COLUMN "revokedAt" TIMESTAMP(3),
ADD COLUMN "revokedByUserId" INTEGER,
ADD COLUMN "consumedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "SupportRequest_approvedByUserId_idx" ON "SupportRequest"("approvedByUserId");

-- CreateIndex
CREATE INDEX "SupportRequest_revokedByUserId_idx" ON "SupportRequest"("revokedByUserId");

-- AddForeignKey
ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
