-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('MEMBER', 'MODERATOR', 'ADMIN', 'SUPERADMIN', 'ROOT');

-- CreateEnum
CREATE TYPE "ChannelVisibility" AS ENUM ('PRIVATE', 'PUBLIC', 'SEMI_PUBLIC', 'DEFAULT');

-- CreateEnum
CREATE TYPE "ChannelMemberRole" AS ENUM ('MEMBER', 'MANAGER');

-- CreateEnum
CREATE TYPE "IndexRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable: User — add role, isBanned, timeoutUntil
ALTER TABLE "User"
  ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
  ADD COLUMN "isBanned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "timeoutUntil" TIMESTAMP(3);

-- Promote the earliest-registered user to ROOT
UPDATE "User"
  SET "role" = 'ROOT'
  WHERE "id" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1);

-- AlterTable: Channel — add visibility, isArchived
ALTER TABLE "Channel"
  ADD COLUMN "visibility" "ChannelVisibility" NOT NULL DEFAULT 'PRIVATE',
  ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- Data migration: mark all existing TEXT/VOICE channels as PUBLIC so they
-- remain visible after the membership-gated sidebar takes effect.
UPDATE "Channel"
  SET "visibility" = 'PUBLIC'
  WHERE "type" IN ('TEXT', 'VOICE');

-- AlterTable: ChannelMember — add role
ALTER TABLE "ChannelMember"
  ADD COLUMN "role" "ChannelMemberRole" NOT NULL DEFAULT 'MEMBER';

-- Data migration: backfill ChannelMember rows for all users on all TEXT/VOICE
-- channels. The old system showed every channel to every user without requiring
-- a membership row. Insert missing rows so the new membership-gated GET / still
-- returns the same channels everyone was already seeing.
INSERT INTO "ChannelMember" ("userId", "channelId", "joinedAt")
  SELECT u."id", c."id", NOW()
  FROM "User" u
  CROSS JOIN "Channel" c
  WHERE c."type" IN ('TEXT', 'VOICE')
  ON CONFLICT ("userId", "channelId") DO NOTHING;

-- Data migration: mark channel creators as MANAGER so they retain ownership rights.
UPDATE "ChannelMember" cm
  SET "role" = 'MANAGER'
  FROM "Channel" c
  WHERE cm."channelId" = c."id"
    AND cm."userId" = c."creatorId"
    AND c."creatorId" IS NOT NULL;

-- CreateTable: Ban
CREATE TABLE "Ban" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "issuedById" TEXT NOT NULL,
  "reason" TEXT,
  "bannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "unbannedAt" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,

  CONSTRAINT "Ban_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Ban_userId_active_idx" ON "Ban"("userId", "active");

-- CreateTable: AuditLog
CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "targetId" TEXT,
  "targetType" TEXT,
  "meta" JSONB,

  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ChannelIndexRequest
CREATE TABLE "ChannelIndexRequest" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "requestedVisibility" "ChannelVisibility" NOT NULL,
  "status" "IndexRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChannelIndexRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelIndexRequest_channelId_key" ON "ChannelIndexRequest"("channelId");

-- CreateTable: ChannelJoinRequest
CREATE TABLE "ChannelJoinRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "message" TEXT,
  "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChannelJoinRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelJoinRequest_userId_channelId_key" ON "ChannelJoinRequest"("userId", "channelId");

-- AddForeignKey
ALTER TABLE "Ban" ADD CONSTRAINT "Ban_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Ban" ADD CONSTRAINT "Ban_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChannelIndexRequest" ADD CONSTRAINT "ChannelIndexRequest_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelJoinRequest" ADD CONSTRAINT "ChannelJoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelJoinRequest" ADD CONSTRAINT "ChannelJoinRequest_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
