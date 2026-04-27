-- CreateEnum
CREATE TYPE "SupportAccessScope" AS ENUM ('VIEW_HOME_STATUS', 'VIEW_CREDENTIALS', 'IMPERSONATE_USER');

-- AlterTable
ALTER TABLE "SupportRequest"
ADD COLUMN "reason" TEXT,
ADD COLUMN "scope" "SupportAccessScope";
