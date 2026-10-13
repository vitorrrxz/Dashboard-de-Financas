-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "pluggyId" TEXT,
    "name" TEXT NOT NULL,
    "bank" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "balance" INTEGER NOT NULL,
    "limit" INTEGER,
    "dueDay" INTEGER,
    "closingDay" INTEGER,
    "pendingBill" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "color" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Account" ("balance", "bank", "closingDay", "color", "createdAt", "dueDay", "id", "limit", "name", "pendingBill", "pluggyId", "type", "userId") SELECT "balance", "bank", "closingDay", "color", "createdAt", "dueDay", "id", "limit", "name", "pendingBill", "pluggyId", "type", "userId" FROM "Account";
DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";
CREATE INDEX "Account_userId_idx" ON "Account"("userId");
CREATE UNIQUE INDEX "Account_userId_pluggyId_key" ON "Account"("userId", "pluggyId");
CREATE TABLE "new_Investment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountInvested" INTEGER NOT NULL,
    "currentValue" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Investment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Investment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Investment" ("accountId", "amountInvested", "createdAt", "currentValue", "id", "name", "type", "updatedAt", "userId") SELECT "accountId", "amountInvested", "createdAt", "currentValue", "id", "name", "type", "updatedAt", "userId" FROM "Investment";
DROP TABLE "Investment";
ALTER TABLE "new_Investment" RENAME TO "Investment";
CREATE INDEX "Investment_userId_idx" ON "Investment"("userId");
CREATE TABLE "new_Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "pluggyId" TEXT,
    "importHash" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "paymentType" TEXT NOT NULL DEFAULT 'debit',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("accountId", "amount", "category", "createdAt", "date", "id", "importHash", "name", "paymentType", "pluggyId", "userId") SELECT "accountId", "amount", "category", "createdAt", "date", "id", "importHash", "name", "paymentType", "pluggyId", "userId" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE INDEX "Transaction_userId_date_idx" ON "Transaction"("userId", "date");
CREATE UNIQUE INDEX "Transaction_userId_importHash_key" ON "Transaction"("userId", "importHash");
CREATE UNIQUE INDEX "Transaction_userId_pluggyId_key" ON "Transaction"("userId", "pluggyId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
