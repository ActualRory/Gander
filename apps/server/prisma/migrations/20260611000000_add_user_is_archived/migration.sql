-- Add soft-archive flag for users (admins can archive departed accounts)
ALTER TABLE "User" ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false;
