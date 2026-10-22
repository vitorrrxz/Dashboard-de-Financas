-- CreateTable
CREATE TABLE "DebtSplit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "debtId" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "DebtSplit_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "Debt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- CreateIndex
CREATE INDEX "DebtSplit_debtId_idx" ON "DebtSplit"("debtId");
