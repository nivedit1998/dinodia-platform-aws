-- AlterTable
ALTER TABLE "HaConnection" ALTER COLUMN "haUsername" DROP NOT NULL,
ADD COLUMN     "haUsernameCiphertext" TEXT,
ALTER COLUMN "haPassword" DROP NOT NULL,
ADD COLUMN     "haPasswordCiphertext" TEXT,
ALTER COLUMN "longLivedToken" DROP NOT NULL,
ADD COLUMN     "longLivedTokenCiphertext" TEXT,
ADD COLUMN     "longLivedTokenHash" TEXT;

-- CreateTable
CREATE TABLE "HubAgentNonce" (
    "id" SERIAL NOT NULL,
    "serial" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "ts" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HubAgentNonce_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HaConnection_longLivedTokenHash_key" ON "HaConnection"("longLivedTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "HubAgentNonce_serial_nonce_key" ON "HubAgentNonce"("serial", "nonce");

-- CreateIndex
CREATE INDEX "HubAgentNonce_createdAt_idx" ON "HubAgentNonce"("createdAt");
