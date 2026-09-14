-- CreateTable
CREATE TABLE "PluggyItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "pluggyId" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lastSyncAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PluggyItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PluggyItem_userId_pluggyId_key" ON "PluggyItem"("userId", "pluggyId");
