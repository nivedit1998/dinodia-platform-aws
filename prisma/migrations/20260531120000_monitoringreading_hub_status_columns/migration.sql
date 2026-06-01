-- AlterTable
ALTER TABLE "MonitoringReading" ADD COLUMN     "hubOnline" BOOLEAN;
ALTER TABLE "MonitoringReading" ADD COLUMN     "hubOfflineGraceSeconds" INTEGER;
ALTER TABLE "MonitoringReading" ADD COLUMN     "hubStatusSource" TEXT;

