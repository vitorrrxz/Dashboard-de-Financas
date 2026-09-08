-- DropIndex
DROP INDEX "Transaction_userId_importHash_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_userId_importHash_key" ON "Transaction"("userId", "importHash");

