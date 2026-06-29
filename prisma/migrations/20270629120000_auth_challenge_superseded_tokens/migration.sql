ALTER TABLE "AuthChallenge"
ADD COLUMN "supersededTokenHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
