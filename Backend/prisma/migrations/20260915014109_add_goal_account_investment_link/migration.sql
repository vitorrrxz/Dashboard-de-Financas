-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Goal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "investmentId" TEXT,
    "name" TEXT NOT NULL,
    "targetAmount" INTEGER NOT NULL,
    "currentAmount" INTEGER NOT NULL DEFAULT 0,
    "targetDate" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Goal_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Goal_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "Investment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Goal" ("createdAt", "currentAmount", "id", "name", "targetAmount", "targetDate", "userId") SELECT "createdAt", "currentAmount", "id", "name", "targetAmount", "targetDate", "userId" FROM "Goal";
DROP TABLE "Goal";
ALTER TABLE "new_Goal" RENAME TO "Goal";
CREATE INDEX "Goal_userId_idx" ON "Goal"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
