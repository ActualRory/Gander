-- Store intrinsic image dimensions so clients can reserve layout space before load
ALTER TABLE "Attachment" ADD COLUMN "width" INTEGER, ADD COLUMN "height" INTEGER;
