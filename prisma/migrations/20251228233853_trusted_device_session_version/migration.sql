-- DropForeignKey
ALTER TABLE "TrustedDevice" DROP CONSTRAINT "TrustedDevice_userId_fkey";

-- AlterTable
ALTER TABLE "TrustedDevice" ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "TrustedDevice" ADD CONSTRAINT "TrustedDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
