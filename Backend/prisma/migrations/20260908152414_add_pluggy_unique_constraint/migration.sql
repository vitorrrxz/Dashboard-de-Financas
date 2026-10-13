-- DropIndex
DROP INDEX "Account_userId_pluggyId_idx";

-- DropIndex
DROP INDEX "Transaction_userId_pluggyId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Account_userId_pluggyId_key" ON "Account"("userId", "pluggyId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_userId_pluggyId_key" ON "Transaction"("userId", "pluggyId");

