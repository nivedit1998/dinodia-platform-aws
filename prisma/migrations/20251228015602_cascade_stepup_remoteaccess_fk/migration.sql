-- DropForeignKey
ALTER TABLE "RemoteAccessLease" DROP CONSTRAINT "RemoteAccessLease_userId_fkey";

-- DropForeignKey
ALTER TABLE "StepUpApproval" DROP CONSTRAINT "StepUpApproval_userId_fkey";

-- AddForeignKey
ALTER TABLE "StepUpApproval" ADD CONSTRAINT "StepUpApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteAccessLease" ADD CONSTRAINT "RemoteAccessLease_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
