-- AlterTable: User — add hashVersion for password migration tracking
ALTER TABLE "User"
  ADD COLUMN "hashVersion" TEXT NOT NULL DEFAULT 'sha256';
