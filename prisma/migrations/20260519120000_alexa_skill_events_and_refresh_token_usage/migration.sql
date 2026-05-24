-- Phase 1: Alexa reliability
-- - Track refresh token usage to avoid "expired" relinks on retries.
-- - Store Alexa Skill Events user mapping for auto-unlink on skill disable/unlink.

-- AlterTable
ALTER TABLE "AlexaRefreshToken"
ADD COLUMN     "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "AlexaSkillUserLink" (
    "id" SERIAL NOT NULL,
    "alexaUserId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "skillId" TEXT,
    "marketplace" TEXT,
    "locale" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),
    "disabledReason" TEXT,
    "lastEventAt" TIMESTAMP(3),
    "lastEventRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AlexaSkillUserLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AlexaSkillUserLink_alexaUserId_key" ON "AlexaSkillUserLink"("alexaUserId");

-- CreateIndex
CREATE INDEX "AlexaSkillUserLink_userId_idx" ON "AlexaSkillUserLink"("userId");

-- CreateIndex (supports token cap/cleanup queries)
CREATE INDEX "AlexaRefreshToken_userId_clientId_revoked_lastUsedAt_idx" ON "AlexaRefreshToken"("userId", "clientId", "revoked", "lastUsedAt");

-- AddForeignKey
ALTER TABLE "AlexaSkillUserLink" ADD CONSTRAINT "AlexaSkillUserLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

