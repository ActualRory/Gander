-- Add author, series, and genre fields to LibraryBook
ALTER TABLE "LibraryBook" ADD COLUMN "author" TEXT;
ALTER TABLE "LibraryBook" ADD COLUMN "series" TEXT;
ALTER TABLE "LibraryBook" ADD COLUMN "genre" TEXT;
