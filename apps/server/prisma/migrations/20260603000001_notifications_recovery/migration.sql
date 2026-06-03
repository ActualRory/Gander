-- CreateEnum
CREATE TYPE "ResetRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable: UserRecovery
CREATE TABLE "UserRecovery" (
  "userId"    TEXT NOT NULL,
  "question1" TEXT NOT NULL,
  "answer1"   TEXT NOT NULL,
  "question2" TEXT NOT NULL,
  "answer2"   TEXT NOT NULL,
  "question3" TEXT NOT NULL,
  "answer3"   TEXT NOT NULL,
  CONSTRAINT "UserRecovery_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "UserRecovery"
  ADD CONSTRAINT "UserRecovery_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: PasswordResetRequest
CREATE TABLE "PasswordResetRequest" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "newPasswordHash" TEXT NOT NULL,
  "status"          "ResetRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedById"    TEXT,
  "reviewedAt"      TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PasswordResetRequest_userId_status_idx" ON "PasswordResetRequest"("userId", "status");

ALTER TABLE "PasswordResetRequest"
  ADD CONSTRAINT "PasswordResetRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: Notification
CREATE TABLE "Notification" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "type"      TEXT NOT NULL,
  "title"     TEXT NOT NULL,
  "body"      TEXT,
  "meta"      JSONB,
  "read"      BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
