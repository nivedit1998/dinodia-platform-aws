-- Phase 1: Homeowner policy acceptance + pending onboarding gates

-- Enums
CREATE TYPE "HomeownerPolicyNotificationRecipientType" AS ENUM ('HOMEOWNER', 'INSTALLER');
CREATE TYPE "HomeownerPolicyNotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');
CREATE TYPE "HomeownerOnboardingFlowType" AS ENUM ('SETUP_QR', 'CLAIM_CODE');

-- Audit enum extension
ALTER TYPE "AuditEventType" ADD VALUE 'HOMEOWNER_POLICY_ACCEPTED';
ALTER TYPE "AuditEventType" ADD VALUE 'HOMEOWNER_POLICY_EMAIL_RESEND_REQUESTED';

-- User cache columns for policy gate
ALTER TABLE "User"
  ADD COLUMN "homeownerPolicyAcceptedVersion" TEXT,
  ADD COLUMN "homeownerPolicyAcceptedAt" TIMESTAMP(3);

-- Acceptance records
CREATE TABLE "HomeownerPolicyAcceptance" (
  "id" TEXT NOT NULL,
  "homeId" INTEGER NOT NULL,
  "homeownerUserId" INTEGER NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "signatureName" TEXT NOT NULL,
  "acceptedStatements" JSONB NOT NULL,
  "addressReference" TEXT NOT NULL,
  "approvedSupportContacts" JSONB,
  "notificationPreference" TEXT,
  "ipHash" TEXT,
  "deviceFingerprintHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "HomeownerPolicyAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HomeownerPolicyAcceptance_homeownerUserId_policyVersion_key"
  ON "HomeownerPolicyAcceptance"("homeownerUserId", "policyVersion");

CREATE INDEX "HomeownerPolicyAcceptance_homeId_idx"
  ON "HomeownerPolicyAcceptance"("homeId");

-- Notification delivery tracking
CREATE TABLE "HomeownerPolicyNotificationDelivery" (
  "id" TEXT NOT NULL,
  "acceptanceId" TEXT NOT NULL,
  "homeId" INTEGER NOT NULL,
  "recipientType" "HomeownerPolicyNotificationRecipientType" NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "status" "HomeownerPolicyNotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "HomeownerPolicyNotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HomeownerPolicyNotificationDelivery_acceptanceId_recipientType_key"
  ON "HomeownerPolicyNotificationDelivery"("acceptanceId", "recipientType");

CREATE INDEX "HomeownerPolicyNotificationDelivery_homeId_status_idx"
  ON "HomeownerPolicyNotificationDelivery"("homeId", "status");

-- Pending onboarding gate for setup/claim flows
CREATE TABLE "PendingHomeownerOnboarding" (
  "id" TEXT NOT NULL,
  "flowType" "HomeownerOnboardingFlowType" NOT NULL,
  "policyVersionRequired" TEXT NOT NULL DEFAULT '2026-V1',
  "claimCodeHash" TEXT,
  "hubInstallId" TEXT,
  "homeId" INTEGER,
  "userId" INTEGER,
  "proposedUsername" TEXT NOT NULL,
  "proposedPasswordHash" TEXT NOT NULL,
  "proposedEmail" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "deviceLabel" TEXT,
  "emailVerifiedAt" TIMESTAMP(3),
  "policyAcceptedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PendingHomeownerOnboarding_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PendingHomeownerOnboarding_flowType_idx"
  ON "PendingHomeownerOnboarding"("flowType");
CREATE INDEX "PendingHomeownerOnboarding_expiresAt_idx"
  ON "PendingHomeownerOnboarding"("expiresAt");
CREATE INDEX "PendingHomeownerOnboarding_homeId_idx"
  ON "PendingHomeownerOnboarding"("homeId");
CREATE INDEX "PendingHomeownerOnboarding_userId_idx"
  ON "PendingHomeownerOnboarding"("userId");
CREATE INDEX "PendingHomeownerOnboarding_hubInstallId_idx"
  ON "PendingHomeownerOnboarding"("hubInstallId");
CREATE INDEX "PendingHomeownerOnboarding_claimCodeHash_idx"
  ON "PendingHomeownerOnboarding"("claimCodeHash");

-- Foreign keys
ALTER TABLE "HomeownerPolicyAcceptance"
  ADD CONSTRAINT "HomeownerPolicyAcceptance_homeId_fkey"
  FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HomeownerPolicyAcceptance"
  ADD CONSTRAINT "HomeownerPolicyAcceptance_homeownerUserId_fkey"
  FOREIGN KEY ("homeownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HomeownerPolicyNotificationDelivery"
  ADD CONSTRAINT "HomeownerPolicyNotificationDelivery_acceptanceId_fkey"
  FOREIGN KEY ("acceptanceId") REFERENCES "HomeownerPolicyAcceptance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HomeownerPolicyNotificationDelivery"
  ADD CONSTRAINT "HomeownerPolicyNotificationDelivery_homeId_fkey"
  FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PendingHomeownerOnboarding"
  ADD CONSTRAINT "PendingHomeownerOnboarding_hubInstallId_fkey"
  FOREIGN KEY ("hubInstallId") REFERENCES "HubInstall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PendingHomeownerOnboarding"
  ADD CONSTRAINT "PendingHomeownerOnboarding_homeId_fkey"
  FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PendingHomeownerOnboarding"
  ADD CONSTRAINT "PendingHomeownerOnboarding_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
