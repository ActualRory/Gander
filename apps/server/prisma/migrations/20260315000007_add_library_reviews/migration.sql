-- CreateTable
CREATE TABLE "LibraryReview" (
    "id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "bookId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,

    CONSTRAINT "LibraryReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LibraryReview_bookId_reviewerId_key" ON "LibraryReview"("bookId", "reviewerId");

-- AddForeignKey
ALTER TABLE "LibraryReview" ADD CONSTRAINT "LibraryReview_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "LibraryBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryReview" ADD CONSTRAINT "LibraryReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
