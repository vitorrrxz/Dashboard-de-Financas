-- PIX recebido que pagou um devedor (conciliação automática). Sem chave estrangeira, e ADD COLUMN em
-- vez de recriar a tabela, como em 20261022210000_extra_incomes.
ALTER TABLE "Transaction" ADD COLUMN "recurringId" TEXT;
