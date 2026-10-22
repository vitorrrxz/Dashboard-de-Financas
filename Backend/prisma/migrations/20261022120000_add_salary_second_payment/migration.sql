-- AlterTable
ALTER TABLE "User" ADD COLUMN "salarySecondCents" INTEGER NOT NULL DEFAULT 0;
-- Quem já era quinzenal recebia o mesmo valor nos dois pagamentos: o 2º começa igual ao 1º.
UPDATE "User" SET "salarySecondCents" = "salaryCents";
