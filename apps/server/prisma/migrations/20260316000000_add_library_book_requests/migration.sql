-- CreateTable
CREATE TABLE "LibraryBookRequest" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "notes" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requesterId" TEXT NOT NULL,

    CONSTRAINT "LibraryBookRequest_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "LibraryBookRequest" ADD CONSTRAINT "LibraryBookRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
