-- Devedor vinculado à dívida que ele paga. ADD COLUMN em vez de recriar a tabela, como em
-- 20261022210000_extra_incomes: excluir a dívida só desfaz o vínculo (SET NULL).
ALTER TABLE "RecurringTransaction" ADD COLUMN "debtId" TEXT REFERENCES "Debt" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "RecurringTransaction_debtId_idx" ON "RecurringTransaction"("debtId");
