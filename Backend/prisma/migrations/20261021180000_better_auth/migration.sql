-- FIN-121 — Better Auth. A senha sai de User.passwordHash para AuthAccount.password (providerId
-- "credential", o login por e-mail e senha), com o mesmo hash bcrypt: ninguém precisa trocar a senha.
-- Ordem pensada para o caso em que as chaves estrangeiras ficam ligadas (dentro de uma transação o
-- PRAGMA foreign_keys=OFF não tem efeito): as tabelas com ON DELETE CASCADE para User só nascem depois
-- de User ser recriada, para o DROP TABLE "User" não apagar nada em cascata.

-- As senhas, guardadas antes de a coluna sumir.
CREATE TABLE "_PasswordMigration" AS SELECT "id" AS "userId", "passwordHash", "createdAt" FROM "User";

-- DropTable (FIN-078: o 2FA próprio dá lugar ao plugin twoFactor; ninguém tinha a verificação ativa)
PRAGMA foreign_keys=off;
DROP TABLE "UserTwoFactor";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "twoFactorEnabled" BOOLEAN DEFAULT false,
    "salaryCents" INTEGER NOT NULL DEFAULT 0,
    "salaryFrequency" TEXT NOT NULL DEFAULT 'monthly',
    "salaryPayDay" INTEGER NOT NULL DEFAULT 15,
    "bonusCents" INTEGER NOT NULL DEFAULT 0,
    "bonusHalf" INTEGER NOT NULL DEFAULT 1,
    "bonusMonth" TEXT
);
INSERT INTO "new_User" ("bonusCents", "bonusHalf", "bonusMonth", "createdAt", "email", "id", "name", "salaryCents", "salaryFrequency", "salaryPayDay") SELECT "bonusCents", "bonusHalf", "bonusMonth", "createdAt", "email", "id", "name", "salaryCents", "salaryFrequency", "salaryPayDay" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATETIME NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuthAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" DATETIME,
    "refreshTokenExpiresAt" DATETIME,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TwoFactor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verified" BOOLEAN DEFAULT true,
    "failedVerificationCount" INTEGER DEFAULT 0,
    "lockedUntil" DATETIME,
    CONSTRAINT "TwoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL
);

-- As senhas guardadas viram a credencial de cada usuário. O id segue o formato UUID v4 dos demais.
INSERT INTO "AuthAccount" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
SELECT
    lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-'
      || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
    "userId", 'credential', "userId", "passwordHash", "createdAt", CURRENT_TIMESTAMP
FROM "_PasswordMigration";
DROP TABLE "_PasswordMigration";

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "AuthAccount_userId_idx" ON "AuthAccount"("userId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE INDEX "TwoFactor_secret_idx" ON "TwoFactor"("secret");

-- CreateIndex
CREATE INDEX "TwoFactor_userId_idx" ON "TwoFactor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimit_key_key" ON "RateLimit"("key");
