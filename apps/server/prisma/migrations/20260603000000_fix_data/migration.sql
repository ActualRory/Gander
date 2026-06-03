-- Idempotent: add hashVersion if the 20260511 migration was never applied
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "hashVersion" TEXT NOT NULL DEFAULT 'sha256';

-- ROOT reassignment: demote any wrongly-promoted ROOT accounts, then promote the
-- correct user. EDIT the username below before running this migration.
UPDATE "User" SET "role" = 'ADMIN' WHERE "role" = 'ROOT';
UPDATE "User" SET "role" = 'ROOT' WHERE "username" = 'rory';
