-- Devedor de uma cobrança não cadastrada (ex.: alguém usou o seu cartão): pagamentos que faltam e o
-- nome da cobrança. ADD COLUMN em vez de recriar a tabela, como em 20261022210000_extra_incomes.
ALTER TABLE "RecurringTransaction" ADD COLUMN "remainingPayments" INTEGER;
ALTER TABLE "RecurringTransaction" ADD COLUMN "chargeName" TEXT;
