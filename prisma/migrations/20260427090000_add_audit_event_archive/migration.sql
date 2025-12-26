-- CreateTable
CREATE TABLE "AuditEventArchive" (
    "id" TEXT NOT NULL,
    "type" "AuditEventType" NOT NULL,
    "metadata" JSONB,
    "homeId" INTEGER,
    "actorUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEventArchive_pkey" PRIMARY KEY ("id")
);
