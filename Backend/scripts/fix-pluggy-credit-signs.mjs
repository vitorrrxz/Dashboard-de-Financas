#!/usr/bin/env node
/**
 * FIN-092 — corrige o sinal das transações de cartão de crédito já gravadas.
 *
 * O sync da Pluggy (server.js) gravava o valor cru vindo da API. Em conta de cartão a
 * Pluggy usa o referencial da fatura: COMPRA vem positiva (aumenta a fatura) e PAGAMENTO
 * da fatura vem negativo. Com isso, toda compra no cartão — inclusive as parcelas já
 * lançadas para meses futuros — era contabilizada como RECEITA no app.
 *
 * `server.js` já normaliza o sinal a partir de agora, e o refresh do sync corrige o que
 * estiver dentro da janela consultada (último mês em diante). Este script existe para o
 * histórico que ficou fora dessa janela.
 *
 * O que faz, apenas em transações vindas da Pluggy (`pluggyId` preenchido) que estão em
 * contas do tipo `credit` e ainda não foram corrigidas (`paymentType != 'credit'`):
 *   1. remove os lançamentos de pagamento da própria fatura — eles duplicam a saída já
 *      registrada na conta corrente e, com o sinal corrigido, virariam receita;
 *   2. inverte o sinal das demais e marca `paymentType = 'credit'`.
 *
 * O `paymentType` funciona como marca de "já corrigido", então rodar o script duas vezes
 * não inverte o sinal de volta.
 *
 * Uso:
 *   node scripts/fix-pluggy-credit-signs.mjs           # simulação: só relata
 *   node scripts/fix-pluggy-credit-signs.mjs --apply   # aplica (faz backup do .db antes)
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

dotenv.config();

// Mesma lista usada por `isCreditCardBillPayment` em server.js.
const CREDIT_CARD_PAYMENT_MARKERS = ['credit card payment', 'pagamento de fatura', 'pagamento recebido'];

/** Se o lançamento é o pagamento da própria fatura (e não uma compra). */
function isBillPayment(tx) {
  const haystack = `${tx.category ?? ''} ${tx.name ?? ''}`.toLowerCase();
  return CREDIT_CARD_PAYMENT_MARKERS.some(marker => haystack.includes(marker));
}

/** Formata centavos como moeda, só para o relatório no terminal. */
function brl(cents) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Copia o arquivo SQLite antes de qualquer escrita, para que a correção seja reversível.
 * Só é possível quando `DATABASE_URL` aponta para um arquivo local; em outros provedores
 * o backup é responsabilidade de quem opera o banco, e o script avisa em vez de seguir
 * dando a impressão de que existe uma cópia.
 */
function backupDatabase(databaseUrl) {
  if (!databaseUrl.startsWith('file:')) {
    console.warn('⚠️  DATABASE_URL não é um arquivo local — nenhum backup automático foi feito.');
    return null;
  }
  const source = path.resolve(databaseUrl.replace(/^file:/, ''));
  if (!fs.existsSync(source)) throw new Error(`Banco não encontrado em ${source}`);
  const target = `${source}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(source, target);
  return target;
}

const apply = process.argv.includes('--apply');
const databaseUrl = process.env.DATABASE_URL || 'file:./dev.db';
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });

try {
  const creditAccounts = await prisma.account.findMany({
    where: { type: 'credit' },
    select: { id: true, name: true, bank: true },
  });

  if (creditAccounts.length === 0) {
    console.log('Nenhuma conta de cartão de crédito encontrada — nada a corrigir.');
    process.exit(0);
  }

  const candidates = await prisma.transaction.findMany({
    where: {
      accountId: { in: creditAccounts.map(a => a.id) },
      pluggyId: { not: null },
      paymentType: { not: 'credit' },
    },
    select: { id: true, name: true, category: true, date: true, amount: true },
  });

  const toDelete = candidates.filter(isBillPayment);
  const toFlip = candidates.filter(tx => !isBillPayment(tx));

  console.log(`Contas de cartão: ${creditAccounts.map(a => a.name).join(', ')}`);
  console.log(`Transações da Pluggy ainda não corrigidas: ${candidates.length}`);
  console.log(`  · pagamentos de fatura a remover: ${toDelete.length} (${brl(toDelete.reduce((s, t) => s + Math.abs(t.amount), 0))})`);
  console.log(`  · lançamentos a inverter de sinal: ${toFlip.length}`);
  const virandoDespesa = toFlip.filter(t => t.amount > 0);
  console.log(`     dos quais ${virandoDespesa.length} deixam de contar como receita (${brl(virandoDespesa.reduce((s, t) => s + t.amount, 0))})`);

  if (!apply) {
    console.log('\nSimulação — nada foi gravado. Rode com --apply para aplicar.');
    process.exit(0);
  }

  const backup = backupDatabase(databaseUrl);
  if (backup) console.log(`\nBackup criado em ${backup}`);

  // Tudo numa transação só: uma falha no meio deixaria parte das transações com o sinal
  // corrigido e parte não, sem como distinguir depois quais já haviam sido tratadas.
  await prisma.$transaction([
    ...(toDelete.length > 0
      ? [prisma.transaction.deleteMany({ where: { id: { in: toDelete.map(t => t.id) } } })]
      : []),
    ...toFlip.map(tx => prisma.transaction.update({
      where: { id: tx.id },
      data: { amount: -tx.amount, paymentType: 'credit' },
    })),
  ]);

  console.log(`\n✅ ${toDelete.length} pagamento(s) de fatura removido(s) e ${toFlip.length} lançamento(s) corrigido(s).`);
} finally {
  await prisma.$disconnect();
}
