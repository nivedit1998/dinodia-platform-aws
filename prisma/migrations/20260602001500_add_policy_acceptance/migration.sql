-- CreateEnum
CREATE TYPE "PolicyKind" AS ENUM ('PRIVACY_NOTICE', 'TERMS');

-- CreateTable
CREATE TABLE "PolicyAcceptance" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "policyKind" "PolicyKind" NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipHash" TEXT,
    "deviceFingerprintHash" TEXT,

    CONSTRAINT "PolicyAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PolicyAcceptance_acceptedAt_idx" ON "PolicyAcceptance"("acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyAcceptance_userId_policyKind_policyVersion_key" ON "PolicyAcceptance"("userId", "policyKind", "policyVersion");

-- AddForeignKey
ALTER TABLE "PolicyAcceptance" ADD CONSTRAINT "PolicyAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

