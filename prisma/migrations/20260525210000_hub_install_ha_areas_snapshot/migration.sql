-- AlterTable
ALTER TABLE "HubInstall" ADD COLUMN     "lastReportedHaAreas" JSONB;
ALTER TABLE "HubInstall" ADD COLUMN     "lastReportedHaAreasAt" TIMESTAMP(3);

