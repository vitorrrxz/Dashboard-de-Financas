-- Bônus de um mês só vira a lista de receitas extras (PLR, 13º...). ADD/DROP COLUMN em vez de
-- recriar a tabela User: no Turso a migration roda numa transação, onde `PRAGMA foreign_keys=OFF`
-- não vale, e o DROP TABLE apagaria em cascata os dados do usuário.
ALTER TABLE "User" ADD COLUMN "extraIncomes" JSONB NOT NULL DEFAULT '[]';

UPDATE "User"
SET "extraIncomes" = json_array(json_object(
  'name', 'Bônus', 'amountCents', "bonusCents", 'month', "bonusMonth", 'half', "bonusHalf", 'yearly', json('false')
))
WHERE "bonusCents" > 0 AND "bonusMonth" IS NOT NULL;

ALTER TABLE "User" DROP COLUMN "bonusCents";
ALTER TABLE "User" DROP COLUMN "bonusHalf";
ALTER TABLE "User" DROP COLUMN "bonusMonth";
