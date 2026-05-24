-- Phase 8: Allow platform to request a hub-side heating usage state reset (telemetry epoch reset)

ALTER TABLE "HubInstall"
ADD COLUMN IF NOT EXISTS "heatingUsageResetRequestedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "heatingUsageResetCompletedAt" TIMESTAMP(3);

