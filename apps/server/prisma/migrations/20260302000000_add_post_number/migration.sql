-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "postNumber" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Message_postNumber_key" ON "Message"("postNumber");
