-- Phase 5: Ephemeral login intents to avoid storing raw passwords client-side.
CREATE TABLE "LoginIntent" (
  "id" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "username" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "deviceId" TEXT NOT NULL,
  "deviceLabel" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LoginIntent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoginIntent_userId_idx" ON "LoginIntent"("userId");
CREATE INDEX "LoginIntent_expiresAt_idx" ON "LoginIntent"("expiresAt");
CREATE INDEX "LoginIntent_revokedAt_idx" ON "LoginIntent"("revokedAt");

ALTER TABLE "LoginIntent"
  ADD CONSTRAINT "LoginIntent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
