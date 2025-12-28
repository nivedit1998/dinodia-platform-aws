-- CreateTable
CREATE TABLE "RemoteAccessLease" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "deviceId" TEXT NOT NULL,
    "purpose" "StepUpPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemoteAccessLease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RemoteAccessLease_tokenHash_key" ON "RemoteAccessLease"("tokenHash");

-- CreateIndex
CREATE INDEX "RemoteAccessLease_userId_deviceId_purpose_idx" ON "RemoteAccessLease"("userId", "deviceId", "purpose");

-- CreateIndex
CREATE INDEX "RemoteAccessLease_expiresAt_idx" ON "RemoteAccessLease"("expiresAt");

-- CreateIndex
CREATE INDEX "RemoteAccessLease_deviceId_idx" ON "RemoteAccessLease"("deviceId");

-- AddForeignKey
ALTER TABLE "RemoteAccessLease" ADD CONSTRAINT "RemoteAccessLease_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
