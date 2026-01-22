-- AlterTable
ALTER TABLE "HubInstall" ADD COLUMN     "lastReportedLanBaseUrl" TEXT,
ADD COLUMN     "lastReportedLanBaseUrlAt" TIMESTAMP(3);
