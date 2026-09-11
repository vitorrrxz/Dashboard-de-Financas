-- CreateTable
CREATE TABLE "UserTwoFactor" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "secret" TEXT NOT NULL,
    "enabledAt" DATETIME,
    "lastUsedStep" INTEGER,
    "recoveryCodes" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserTwoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
