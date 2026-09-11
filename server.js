import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { PluggyClient } from 'pluggy-sdk';
import crypto from 'crypto';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { fileURLToPath } from 'url';
import * as OTPAuth from 'otpauth';
import qrcode from 'qrcode-generator';

dotenv.config();

const app = express();
app.use(helmet()); // cabeçalhos de segurança HTTP padrão (ver FIN-010)
// CORS restrito à origem conhecida do frontend — evita que qualquer site de terceiros
// consiga ler respostas desta API (ver FIN-009 em docs/BACKLOG_DETAIL.md).
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
// Corpo JSON de até 100 kB (padrão do Express) em todas as rotas, menos a restauração de backup
// (FIN-080): ela recebe o arquivo inteiro e usa um parser próprio, com limite maior, que só roda
// depois da autenticação — ver a rota.
const BACKUP_IMPORT_PATH = '/api/account/import';
// Sem caixa e sem barra final, porque o roteamento do Express também ignora as duas.
function isBackupImportPath(req) {
  return req.path.replace(/\/+$/, '').toLowerCase() === BACKUP_IMPORT_PATH;
}
const jsonBody = express.json();
app.use((req, res, next) => (isBackupImportPath(req) ? next() : jsonBody(req, res, next)));

const PORT = 3001;
const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || 'file:./dev.db',
});
const prisma = new PrismaClient({ adapter });

// JWT_SECRET é obrigatório — sem fallback. Um valor hardcoded no código-fonte
// tornaria trivial forjar tokens válidos para qualquer usuário (ver FIN-006 no TODO.md).
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error(
    '\n❌ JWT_SECRET ausente ou fraco (mínimo 32 caracteres).\n' +
    '   Defina JWT_SECRET no arquivo .env antes de iniciar o servidor.\n' +
    '   Para gerar uma chave segura, rode:\n' +
    '   node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n'
  );
  process.exit(1);
}

// Pluggy Client — inicialização preguiçosa (lazy). O construtor do SDK lança exceção
// síncrona ("Missing authorization for API communication") quando clientId/clientSecret
// estão vazios — como essas credenciais são opcionais (só necessárias para conectar
// bancos reais, ver .env.example), instanciar no topo do módulo derrubava o servidor
// inteiro no boot para quem não configurou Pluggy. Agora só é criado (e só falha) quando
// uma rota Pluggy é de fato chamada.
let pluggyClient = null;
function getPluggyClient() {
  if (pluggyClient) return pluggyClient;
  if (!process.env.PLUGGY_CLIENT_ID || !process.env.PLUGGY_CLIENT_SECRET) {
    throw new Error('Integração com Pluggy não configurada (PLUGGY_CLIENT_ID/PLUGGY_CLIENT_SECRET ausentes no .env).');
  }
  pluggyClient = new PluggyClient({
    clientId: process.env.PLUGGY_CLIENT_ID,
    clientSecret: process.env.PLUGGY_CLIENT_SECRET,
  });
  return pluggyClient;
}

// Mapeia o `type`/`subtype` retornado pela Pluggy para o enum AccountType do frontend
// (checking | savings | credit | investment | cash). A Pluggy só retorna `type` como
// "BANK" ou "CREDIT" (ver node_modules/pluggy-sdk/dist/types/account.d.ts) — a distinção
// entre conta corrente e poupança vem do `subtype` ("CHECKING_ACCOUNT"/"SAVINGS_ACCOUNT").
// Sem esse mapeamento, `pluggyAcc.type.toLowerCase()` gerava "bank", que não é nenhum
// AccountType válido e quebrava ícone/rótulo no frontend (ver FIN-002 em docs/BACKLOG_DETAIL.md).
function mapPluggyAccountType(pluggyAcc) {
  if (pluggyAcc.type === 'CREDIT') return 'credit';
  if (pluggyAcc.type === 'BANK') {
    return pluggyAcc.subtype === 'SAVINGS_ACCOUNT' ? 'savings' : 'checking';
  }
  return 'checking';
}

// Traduz o `status` de um item Pluggy (ver node_modules/pluggy-sdk/dist/types/item.d.ts)
// numa mensagem acionável quando indica que a conexão precisa de reautenticação — ver
// FIN-041 em docs/BACKLOG_DETAIL.md. `null` significa "nada a avisar, prossiga
// normalmente" (inclui UPDATED, UPDATING, MERGING e os estados de MFA em andamento, que
// não são erros).
function pluggyReauthMessage(status) {
  if (status === 'LOGIN_ERROR') {
    return 'A conexão com este banco expirou ou as credenciais mudaram. Reconecte o banco para continuar sincronizando.';
  }
  if (status === 'OUTDATED') {
    return 'A última tentativa de sincronização deste banco falhou. Tente novamente; se o problema persistir, reconecte o banco.';
  }
  return null;
}

// Chave determinística de deduplicação para importação manual (CSV/OFX) — ver FIN-003.
// Quando o extrato traz um `externalId` (FITID do OFX — identificador estável atribuído
// pelo próprio banco), ele é usado como chave: é a identidade real da transação, evitando
// falso positivo quando duas transações distintas têm mesmo nome/data/valor (ex. duas
// compras idênticas no mesmo dia). CSV não tem equivalente padronizado, então cai no
// heurístico conta+data+valor+nome (não `id` do parser, que é aleatório a cada parse).
function computeImportHash(userId, tx) {
  const key = tx.externalId
    ? [userId, tx.accountId || '', 'ext', tx.externalId]
    : [
        userId,
        tx.accountId || '',
        tx.date || '',
        Number(tx.amount).toFixed(2),
        String(tx.name || '').trim().toLowerCase(),
      ];
  return crypto.createHash('sha256').update(key.join('|')).digest('hex');
}

// Aritmética de datas ISO para o processamento de recorrências (FIN-054). Duplicado de
// `src/utils/dates.ts` pelo mesmo motivo de `toCents`: backend (Node puro) e frontend
// (bundle Vite/TS) não compartilham módulos neste projeto. Os testes de
// `src/utils/dates.test.ts` cobrem a versão canônica; `server.recurring.test.js` cobre o
// comportamento desta, via endpoint.
function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
function daysInMonth(year, month) {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
function formatISODate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Próxima ocorrência de uma recorrência, conforme a frequência. O dia é "clampado" ao
 * último dia válido do mês de destino (31/jan → 28 ou 29/fev; 29/fev → 28/fev no ano
 * seguinte), então nunca produz uma data inexistente, e o resultado é sempre estritamente
 * maior que a entrada — o que garante o avanço do laço de lançamento em
 * `/api/recurring-transactions/process`.
 */
function advanceOccurrence(dateString, frequency) {
  const parts = dateString.split('-');
  if (parts.length !== 3) return dateString;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return dateString;
  if (month < 1 || month > 12 || day < 1) return dateString;

  if (frequency === 'weekly') {
    // `new Date(y, mIndex, d)` usa componentes locais (não faz parse UTC de string, ao
    // contrário de `new Date('YYYY-MM-DD')`) e normaliza sozinho a virada de mês/ano.
    const d = new Date(year, month - 1, day + 7);
    return formatISODate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  if (frequency === 'yearly') {
    return formatISODate(year + 1, month, Math.min(day, daysInMonth(year + 1, month)));
  }
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return formatISODate(nextYear, nextMonth, Math.min(day, daysInMonth(nextYear, nextMonth)));
}

/**
 * Data de hoje no fuso local do servidor, como string ISO — mesma convenção (e mesmo
 * motivo de não usar `toISOString()`, que é UTC) de `todayISO` em `src/utils/debts.ts`.
 */
function todayISO() {
  const d = new Date();
  return formatISODate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * Chave determinística de uma ocorrência de recorrência, gravada em `Transaction.importHash`.
 * Reaproveita a constraint única `(userId, importHash)` criada em FIN-003 para tornar o
 * lançamento idempotente **no banco**, não só na aplicação: se o processamento rodar duas
 * vezes em paralelo (ex.: dois carregamentos simultâneos do dashboard, ou o duplo efeito do
 * StrictMode em dev), a segunda tentativa não cria uma transação duplicada.
 */
function recurringOccurrenceHash(userId, recurringId, occurrenceDate) {
  return crypto.createHash('sha256').update(['recurring', userId, recurringId, occurrenceDate].join('|')).digest('hex');
}

// Teto de ocorrências geradas por chamada, por recorrência. Uma recorrência semanal parada
// há anos geraria centenas de transações numa única requisição; o teto distribui isso entre
// chamadas sucessivas (o ponteiro `nextOccurrence` avança a cada uma) e também limita o
// estrago caso `advanceOccurrence` deixe de avançar por um dado inesperado.
const MAX_OCCURRENCES_PER_RUN = 120;

// Converte reais (decimal) para centavos (inteiro) — ver FIN-015. A API da Pluggy retorna
// valores em reais; o schema local agora armazena tudo em centavos. Duplicado de
// `src/utils/money.ts` porque backend (Node puro) e frontend (bundle Vite) não
// compartilham módulos TS neste projeto.
function toCents(reais) {
  return Math.round(reais * 100);
}

// FIN-092 — Sinal das transações vindas da Pluggy.
//
// Em conta BANK a Pluggy já devolve o valor na convenção do app: negativo = saiu dinheiro,
// positivo = entrou. Em conta CREDIT o referencial é o da fatura, não o do bolso do
// usuário: uma COMPRA aumenta a fatura e vem POSITIVA; o PAGAMENTO da fatura a reduz e vem
// NEGATIVO. Importar esse valor cru fazia toda compra no cartão — inclusive as parcelas já
// lançadas para meses futuros — ser contabilizada como receita.
//
// O discriminador é o tipo da CONTA, e não o campo `type` (DEBIT/CREDIT) da transação:
// `type` seria mais genérico, mas não foi possível confirmar sua polaridade nos conectores
// de cartão contra dados reais, e um engano ali inverteria também as contas correntes, que
// hoje estão corretas. O tipo da conta foi conferido contra o extrato real de um cartão.
function pluggyAmountToCents(pluggyTx, accountType) {
  const cents = toCents(pluggyAmountInAccountCurrency(pluggyTx));
  // O teste de zero evita gravar -0: inofensivo em SQLite, mas confuso ao depurar.
  if (accountType !== 'credit' || cents === 0) return cents;
  return -cents;
}

// FIN-095 — Valor de uma compra em moeda estrangeira.
//
// Numa compra internacional no cartão, `amount` vem na moeda da COMPRA (dólares, por exemplo)
// e `amountInAccountCurrency` no valor que entra na fatura, na moeda da CONTA. Gravar
// `amount` registrava US$ 10 como R$ 10. O app guarda o valor na moeda da conta — é o que o
// usuário paga e o que soma com o resto do extrato. Do campo novo só se usa o módulo: o sinal
// continua vindo de `amount`, cuja convenção foi conferida contra dados reais em FIN-092.
function pluggyAmountInAccountCurrency(pluggyTx) {
  const inAccount = pluggyTx.amountInAccountCurrency;
  if (typeof inAccount !== 'number' || !Number.isFinite(inAccount)) return pluggyTx.amount;
  const sign = pluggyTx.amount < 0 ? -1 : pluggyTx.amount > 0 ? 1 : Math.sign(inAccount);
  return sign * Math.abs(inAccount);
}

// Marcadores com que a Pluggy identifica o pagamento da própria fatura do cartão. A
// comparação é por inclusão e em minúsculas porque o texto varia entre conectores
// (categoria normalizada em inglês, descrição no idioma do banco).
const CREDIT_CARD_PAYMENT_MARKERS = ['credit card payment', 'pagamento de fatura', 'pagamento recebido'];

// Um lançamento de cartão que é o pagamento da fatura, e não uma compra.
//
// Ele não é uma movimentação nova: o dinheiro já saiu da conta corrente (onde aparece como
// despesa) e as compras que compõem a fatura já foram contabilizadas uma a uma. Importá-lo
// somaria o mesmo valor duas vezes — e, com o sinal corrigido acima, ainda apareceria como
// RECEITA. A verificação só é aplicada em contas de cartão: numa conta corrente,
// "pagamento recebido" é uma entrada legítima.
function isCreditCardBillPayment(pluggyTx) {
  const haystack = ((pluggyTx.category ?? '') + ' ' + (pluggyTx.description ?? '')).toLowerCase();
  return CREDIT_CARD_PAYMENT_MARKERS.some(marker => haystack.includes(marker));
}

// FIN-074 — moeda de uma conta vinda da Pluggy (`currencyCode`, ISO 4217). Código ausente ou
// fora do padrão cai em real — a moeda de todas as contas antes de FIN-074 —, porque um valor
// inválido gravado aqui impediria a conversão de todos os totais da conta. Um código válido
// fora da lista do app é gravado como veio: a tela mostra o código e avisa se faltar cotação.
function pluggyCurrency(currencyCode) {
  return typeof currencyCode === 'string' && CURRENCY_CODE_PATTERN.test(currencyCode) ? currencyCode : BASE_CURRENCY;
}

/* -------------------------------------------------------------------------- */
/*                        NOTIFICAÇÕES (FIN-065 a FIN-069)                     */
/* -------------------------------------------------------------------------- */

/**
 * Lê um parâmetro numérico do ambiente, caindo no padrão quando ausente ou inválido — um
 * valor malformado no `.env` não deve derrubar o servidor nem virar `NaN` silencioso no
 * cálculo das notificações.
 */
function readNumberEnv(name, fallback, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    console.warn(`⚠️  ${name}="${raw}" inválido — usando o padrão ${fallback}.`);
    return fallback;
  }
  return value;
}

// Parâmetros das notificações automáticas, configuráveis por ambiente (ver .env.example).
const NOTIFICATION_SETTINGS = {
  // Com quantos dias de antecedência avisar sobre uma parcela ou fatura (FIN-067).
  dueSoonDays: readNumberEnv('NOTIFY_DUE_SOON_DAYS', 7, { min: 0, max: 60, integer: true }),
  // Quantos meses anteriores formam a média de gasto por categoria (FIN-069).
  unusualSpendingMonths: readNumberEnv('UNUSUAL_SPENDING_MONTHS', 3, { min: 2, max: 12, integer: true }),
  // Quanto acima da média (0.5 = 50%) o gasto do mês precisa ficar para gerar alerta.
  unusualSpendingThreshold: readNumberEnv('UNUSUAL_SPENDING_THRESHOLD', 0.5, { min: 0.1, max: 10 }),
  // Diferença mínima, em centavos, entre o gasto do mês e a média — sem ela, uma categoria de
  // valor baixo geraria alerta por variação irrelevante (R$ 12 → R$ 20 é +66%, mas não importa).
  unusualSpendingMinCents: readNumberEnv('UNUSUAL_SPENDING_MIN_CENTS', 5000, { min: 0, integer: true }),
};

// Mínimo de meses anteriores com dados para existir uma "média" a comparar (FIN-069). Com um
// mês só, qualquer variação normal de um mês para o outro viraria alerta.
const MIN_BASELINE_MONTHS = 2;

/** Soma `days` dias a uma data ISO, com componentes locais (sem parse UTC de string). */
function addDaysISO(dateString, days) {
  const [year, month, day] = dateString.split('-').map(Number);
  const d = new Date(year, month - 1, day + days);
  return formatISODate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Desloca uma chave de mês (YYYY-MM) em `delta` meses — espelho de `shiftMonth` em src/utils/dates.ts. */
function shiftMonthKey(month, delta) {
  const [year, monthNumber] = month.split('-').map(Number);
  const absolute = year * 12 + (monthNumber - 1) + delta;
  const newYear = Math.floor(absolute / 12);
  return `${newYear}-${String(absolute - newYear * 12 + 1).padStart(2, '0')}`;
}

/** Nome do mês com inicial maiúscula ("Setembro"), montado com componentes numéricos. */
function monthLabelPtBR(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const name = new Date(year, monthNumber - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// FIN-074 — símbolo de cada moeda aceita pelo app. Espelha `CURRENCY_SYMBOLS` de
// src/utils/currency.ts, pelo mesmo motivo das outras duplicações deste arquivo: backend e
// frontend não compartilham módulos. As chaves são a lista de moedas aceitas nos cadastros.
const CURRENCY_SYMBOLS = { BRL: 'R$', USD: 'US$', EUR: '€', GBP: '£', CHF: 'CHF', CAD: 'C$', AUD: 'A$' };

/**
 * "US$ 1.234,56" a partir de centavos — mesmo formato de `formatMoney` no frontend. Moeda
 * fora da lista aparece pelo código ISO.
 */
function formatCents(cents, currency = 'BRL') {
  const symbol = Object.prototype.hasOwnProperty.call(CURRENCY_SYMBOLS, currency) ? CURRENCY_SYMBOLS[currency] : currency;
  const value = (Math.abs(cents) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbol} ${value}`;
}

/** "R$ 1.234,56" a partir de centavos — mesmo formato de `formatBRL` no frontend. */
function formatCentsBRL(cents) {
  return formatCents(cents, 'BRL');
}

/** "15/09" a partir de uma data ISO, sem passar por `Date` (imune a fuso). */
function formatDayMonth(dateString) {
  const [, month, day] = dateString.split('-');
  return `${day}/${month}`;
}

/** Mesma regra de `isDebtPaid` em src/utils/debts.ts: quitada pelo valor OU pelas parcelas. */
function isDebtPaid(debt) {
  return debt.paidAmount >= debt.totalAmount || debt.paidInstallments >= debt.totalInstallments;
}

/**
 * Valor da próxima parcela de uma dívida, em centavos: a parcela cheia limitada ao saldo, e
 * a última fechando o saldo exato — mesma regra de `remainingDebtSchedule` no frontend.
 */
function nextInstallmentCents(debt) {
  const balance = Math.max(0, debt.totalAmount - debt.paidAmount);
  const isLast = debt.totalInstallments - debt.paidInstallments <= 1;
  return isLast ? balance : Math.min(debt.monthlyPayment, balance);
}

/**
 * Próximo vencimento da fatura de um cartão, a partir do dia de vencimento cadastrado: o
 * deste mês se ainda não passou (hoje conta), senão o do mês seguinte. O dia é "clampado" ao
 * tamanho do mês — vencimento no dia 31 cai em 30/set e em 28 ou 29/fev.
 */
function nextBillDueDate(dueDay, today) {
  const [year, month] = today.split('-').map(Number);
  const thisMonth = formatISODate(year, month, Math.min(dueDay, daysInMonth(year, month)));
  if (thisMonth >= today) return thisMonth;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return formatISODate(nextYear, nextMonth, Math.min(dueDay, daysInMonth(nextYear, nextMonth)));
}

/**
 * Dia de vencimento (1–31) de uma fatura da Pluggy, ou `undefined` se a data não vier ou for
 * inválida. As datas de fatura chegam como meia-noite UTC: ler o dia em UTC evita que o fuso
 * do Brasil (UTC-3) o desloque para o dia anterior.
 */
function pluggyBillDueDay(bill) {
  if (!bill?.dueDate) return undefined;
  const date = new Date(bill.dueDate);
  return Number.isNaN(date.getTime()) ? undefined : date.getUTCDate();
}

/**
 * Notificações de vencimento (FIN-067): parcelas de dívida que vencem nos próximos
 * `dueSoonDays` dias, parcelas já vencidas e faturas de cartão prestes a vencer.
 *
 * Cada candidata carrega uma `dedupeKey` que identifica a OCORRÊNCIA — a dívida e a data do
 * vencimento, ou o cartão e a data da fatura. Quando a parcela é paga, `nextDueDate` avança e
 * a próxima ocorrência ganha uma chave nova; o aviso da anterior não é recriado. As mensagens
 * usam datas absolutas ("vence em 15/09"), nunca relativas ("vence amanhã"), porque ficam
 * gravadas e seriam lidas em outro dia.
 *
 * Função pura (valores em centavos, datas ISO), exportada para os testes.
 */
function buildDueNotifications(debts, accounts, today, dueSoonDays) {
  const limit = addDaysISO(today, dueSoonDays);
  const candidates = [];

  for (const debt of debts) {
    if (isDebtPaid(debt)) continue;
    const due = debt.nextDueDate;
    const installment = `parcela ${debt.paidInstallments + 1}/${debt.totalInstallments}`;
    const amount = formatCentsBRL(nextInstallmentCents(debt));
    if (due < today) {
      candidates.push({
        type: 'debt_overdue',
        dedupeKey: `debt_overdue:${debt.id}:${due}`,
        title: debt.name,
        message: `A ${installment} (${amount}) venceu em ${formatDayMonth(due)} e ainda não foi paga.`,
      });
    } else if (due <= limit) {
      candidates.push({
        type: 'debt_due',
        dedupeKey: `debt_due:${debt.id}:${due}`,
        title: debt.name,
        message: `A ${installment} (${amount}) vence em ${formatDayMonth(due)}.`,
      });
    }
  }

  for (const account of accounts) {
    if (account.type !== 'credit' || !(account.pendingBill > 0)) continue;
    if (!Number.isInteger(account.dueDay) || account.dueDay < 1 || account.dueDay > 31) continue;
    const due = nextBillDueDate(account.dueDay, today);
    if (due > limit) continue;
    candidates.push({
      type: 'bill_due',
      dedupeKey: `bill_due:${account.id}:${due}`,
      title: `Fatura ${account.name}`,
      // FIN-074: a fatura na moeda do cartão ("US$ 100,00" num cartão em dólar).
      message: `A fatura de ${formatCents(account.pendingBill, account.currency || 'BRL')} vence em ${formatDayMonth(due)}.`,
    });
  }

  return candidates;
}

/**
 * Alertas de gasto incomum (FIN-069): compara, por categoria, o gasto do mês corrente com a
 * média mensal dos meses anteriores e sinaliza as categorias que passaram do limiar.
 *
 * Decisões que evitam falso alarme:
 * - Só entra na média um mês anterior que esteja inteiro dentro do histórico do usuário
 *   (começa depois da primeira transação conhecida) E que tenha alguma transação. Um mês sem
 *   dado — antes de o usuário começar, fora da janela sincronizada, ou uma lacuna de
 *   importação — não é um mês de gasto zero; contá-lo derrubaria a média e acusaria tudo de
 *   incomum. Com menos de `MIN_BASELINE_MONTHS` meses assim, nada é gerado.
 * - Dentro desses meses, uma categoria sem gasto conta como zero — isso sim é informação.
 * - O mês corrente conta só até hoje: parcelas já lançadas para o fim do mês ainda não
 *   aconteceram. Comparar um mês parcial com meses cheios só subestima o atual, então o que
 *   passa do limiar é desvio real.
 * - Além do percentual, a diferença absoluta precisa chegar a `minCents`.
 *
 * `transactions` em centavos (negativo = despesa). A `dedupeKey` inclui o mês: no máximo um
 * alerta por categoria por mês, atualizado (não duplicado) conforme o gasto cresce.
 */
function detectUnusualSpending(transactions, today, { months, threshold, minCents, historyStart } = {}) {
  if (transactions.length === 0) return [];
  const currentMonth = today.slice(0, 7);
  const start = historyStart ?? transactions.reduce((min, t) => (t.date < min ? t.date : min), transactions[0].date);

  const monthsWithData = new Set(transactions.map(t => t.date.slice(0, 7)));
  const baselineMonths = Array.from({ length: months }, (_, i) => shiftMonthKey(currentMonth, -(i + 1)))
    .filter(month => `${month}-01` >= start && monthsWithData.has(month));
  if (baselineMonths.length < MIN_BASELINE_MONTHS) return [];

  // mês → (categoria → centavos gastos)
  const spendByMonth = new Map();
  for (const t of transactions) {
    if (t.amount >= 0) continue;
    const month = t.date.slice(0, 7);
    const counts = month === currentMonth ? t.date <= today : baselineMonths.includes(month);
    if (!counts) continue;
    const byCategory = spendByMonth.get(month) ?? new Map();
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) - t.amount);
    spendByMonth.set(month, byCategory);
  }

  const current = spendByMonth.get(currentMonth);
  if (!current) return [];

  const label = monthLabelPtBR(currentMonth);
  const candidates = [];
  for (const [category, spent] of current) {
    const total = baselineMonths.reduce((sum, month) => sum + (spendByMonth.get(month)?.get(category) ?? 0), 0);
    const average = total / baselineMonths.length;
    if (spent - average < minCents) continue;
    if (spent < average * (1 + threshold)) continue;

    const base = `${label}: ${formatCentsBRL(spent)} em ${category}`;
    candidates.push({
      type: 'unusual_spending',
      dedupeKey: `unusual_spending:${currentMonth}:${category}`,
      title: `Gasto acima do normal em ${category}`,
      message: average > 0
        ? `${base}, ${Math.round((spent / average - 1) * 100)}% acima da média de ${formatCentsBRL(Math.round(average))} dos ${baselineMonths.length} meses anteriores.`
        : `${base}, sem gasto nessa categoria nos ${baselineMonths.length} meses anteriores.`,
    });
  }
  return candidates.sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));
}

/* -------------------------------------------------------------------------- */
/*                      CÂMBIO PARA EXIBIÇÃO (FIN-075)                        */
/* -------------------------------------------------------------------------- */
// Os totais do app são exibidos em real; contas e posições em outra moeda entram neles
// convertidas pela cotação do dia. Provedor: Frankfurter (cotações de referência do Banco
// Central Europeu) — gratuito, sem chave de acesso, de código aberto e hospedável por conta
// própria. A avaliação dos provedores está em FIN-075 (docs/BACKLOG_DETAIL.md);
// `EXCHANGE_RATES_URL` aponta para outra instância sem mudar código.
const BASE_CURRENCY = 'BRL';
const EXCHANGE_RATES_URL = (process.env.EXCHANGE_RATES_URL || 'https://api.frankfurter.dev/v1').replace(/\/+$/, '');
// O BCE publica uma cotação por dia útil: com 12 h de cache, o servidor consulta o provedor no
// máximo duas vezes por dia, não importa quantos usuários abram o app.
const EXCHANGE_RATES_TTL_MS = 12 * 60 * 60 * 1000;
// Depois de uma falha, espera antes de tentar de novo — com o provedor fora do ar, cada
// carregamento do app esperaria o timeout inteiro.
const EXCHANGE_RATES_RETRY_MS = 5 * 60 * 1000;
const EXCHANGE_RATES_TIMEOUT_MS = 5000;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

/**
 * Valida a resposta do provedor (`{ base, date, rates }`) e a inverte para "quantos reais vale
 * 1 unidade de cada moeda" — o provedor responde quantas unidades de cada moeda valem 1 real.
 * Cada cotação que não seja um número positivo é descartada (um 0 viraria divisão por zero).
 * Devolve `null` quando a resposta não tem o formato esperado.
 */
function parseProviderRates(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { base, date, rates } = body;
  if (base !== BASE_CURRENCY || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!rates || typeof rates !== 'object' || Array.isArray(rates)) return null;
  const perUnit = {};
  for (const [code, perReal] of Object.entries(rates)) {
    if (CURRENCY_CODE_PATTERN.test(code) && typeof perReal === 'number' && Number.isFinite(perReal) && perReal > 0) {
      perUnit[code] = 1 / perReal;
    }
  }
  return { date, rates: perUnit };
}

/**
 * Cache das cotações: validade de `ttlMs`, uma única consulta em andamento por vez e espera
 * de `retryMs` depois de uma falha. Se a atualização falha e há cotação anterior, serve a
 * anterior marcada como `stale` — o app continua convertendo e a tela avisa que a cotação é
 * antiga. Sem cotação nenhuma, a falha sobe para quem chamou. `now` é injetável nos testes.
 */
function createExchangeRateCache({ fetchRates, ttlMs, retryMs, now = () => Date.now() }) {
  let cached = null; // { date, rates, fetchedAt }
  let lastFailureAt = -Infinity;
  let inflight = null;

  const serve = (entry, stale) => ({ date: entry.date, rates: entry.rates, stale });

  return async function getRates() {
    if (cached && now() - cached.fetchedAt < ttlMs) return serve(cached, false);
    if (now() - lastFailureAt < retryMs) {
      if (cached) return serve(cached, true);
      throw new Error('Cotações indisponíveis; nova tentativa em instantes.');
    }
    if (!inflight) {
      // `Promise.resolve().then` torna assíncrona até uma exceção síncrona de `fetchRates`,
      // para ela passar pelo mesmo caminho de falha.
      const attempt = Promise.resolve()
        .then(() => fetchRates())
        .then(
          fresh => {
            cached = { date: fresh.date, rates: fresh.rates, fetchedAt: now() };
            return cached;
          },
          err => {
            lastFailureAt = now();
            throw err;
          }
        );
      inflight = attempt;
      // Libera a vaga só depois de a tentativa terminar, e só se ela ainda for a atual.
      attempt.finally(() => { if (inflight === attempt) inflight = null; }).catch(() => {});
    }
    try {
      return serve(await inflight, false);
    } catch (err) {
      if (cached) return serve(cached, true);
      throw err;
    }
  };
}

/** Consulta o provedor de câmbio (com timeout) e devolve as cotações já validadas. */
async function fetchProviderRates() {
  const res = await fetch(`${EXCHANGE_RATES_URL}/latest?base=${BASE_CURRENCY}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(EXCHANGE_RATES_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Provedor de câmbio respondeu HTTP ${res.status}.`);
  const parsed = parseProviderRates(await res.json().catch(() => null));
  if (!parsed) throw new Error('Provedor de câmbio respondeu num formato inesperado.');
  return parsed;
}

const getExchangeRates = createExchangeRateCache({
  fetchRates: fetchProviderRates,
  ttlMs: EXCHANGE_RATES_TTL_MS,
  retryMs: EXCHANGE_RATES_RETRY_MS,
});

// Loga o erro completo no servidor e retorna uma mensagem genérica ao cliente — nunca
// `error.message`/detalhes internos do Prisma/Node, que podem vazar schema, nomes de
// coluna etc. (ver FIN-011 em docs/BACKLOG_DETAIL.md).
function sendInternalError(res, error, publicMessage = 'Erro interno do servidor.') {
  console.error(publicMessage, error);
  res.status(500).json({ error: publicMessage });
}

// Rate limit nas rotas de autenticação — mitiga força bruta e enumeração de credenciais
// (ver FIN-007 em docs/BACKLOG_DETAIL.md). Não afeta as demais rotas da API.
// Limite configurável via env var só para não estourar em testes de integração (FIN-031 a
// FIN-033), que fazem dezenas de register/login em sequência contra o mesmo app — em
// produção, sem AUTH_RATE_LIMIT definida, o limite continua 10 (mesmo valor de antes).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: Number(process.env.AUTH_RATE_LIMIT) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});

/* -------------------------------------------------------------------------- */
/*                        VALIDAÇÃO DE PAYLOAD (FIN-008)                      */
/* -------------------------------------------------------------------------- */
// Antes desta tarefa, as rotas de CRUD (accounts/transactions/debts) gravavam
// `req.body` quase sem checagem, permitindo dados financeiros inconsistentes
// (ex.: `totalInstallments: 0`, causando divisão por zero no frontend). Cada rota
// agora valida o payload com um schema Zod antes de tocar o banco.

function validateBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues.map(i => i.message).join(' ') || 'Dados inválidos.';
    return { ok: false, message };
  }
  return { ok: true, data: result.data };
}

// Campos monetários trafegam em CENTAVOS (inteiro) entre API e frontend — ver FIN-015
// em docs/BACKLOG_DETAIL.md. `interestRate` é a única exceção: é uma taxa percentual
// (% ao mês), não um valor monetário, e permanece decimal.
// FIN-074 — moedas aceitas nos cadastros: as chaves de `CURRENCY_SYMBOLS`, as mesmas do
// frontend (`SUPPORTED_CURRENCIES` em src/utils/currency.ts — um teste garante que as listas
// não divergem) e todas cotadas pelo provedor de câmbio (FIN-075).
const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_SYMBOLS);
const currencyField = z.enum(SUPPORTED_CURRENCIES, {
  message: `Moeda deve ser uma de: ${SUPPORTED_CURRENCIES.join(', ')}.`,
}).optional();

const ACCOUNT_TYPES = ['checking', 'savings', 'credit', 'investment', 'cash'];
const accountSchema = z.object({
  name: z.string({ error: 'Nome da conta é obrigatório.' }).trim().min(1, 'Nome da conta é obrigatório.'),
  bank: z.string({ error: 'Banco/operadora é obrigatório.' }).trim().min(1, 'Banco/operadora é obrigatório.'),
  type: z.enum(ACCOUNT_TYPES, { message: `Tipo de conta deve ser um de: ${ACCOUNT_TYPES.join(', ')}.` }),
  balance: z.coerce.number().int('Saldo deve ser um valor inteiro em centavos.'),
  limit: z.coerce.number().int('Limite deve ser um valor inteiro em centavos.').nullable().optional(),
  dueDay: z.coerce.number().int().min(1).max(31).nullable().optional(),
  closingDay: z.coerce.number().int().min(1).max(31).nullable().optional(),
  pendingBill: z.coerce.number().int('Fatura deve ser um valor inteiro em centavos.').nullable().optional(),
  currency: currencyField, // FIN-074 — ausente no cadastro = real (padrão do banco)
  color: z.string({ error: 'Cor é obrigatória.' }).trim().min(1, 'Cor é obrigatória.'),
});
const accountUpdateSchema = accountSchema.partial();

// Aceita `accountId: ''` (usado pelo frontend para "sem conta vinculada") como sinônimo
// de `null` — sem isso, `z.string().min(1)` rejeitava string vazia com um erro de
// validação antes mesmo do handler rodar, tornando inalcançável a normalização que a
// rota PUT /api/debts/:id fazia depois (ver correção abaixo).
const accountIdField = z.preprocess(
  v => (v === '' ? null : v),
  z.string().trim().min(1).nullable().optional()
);

const PAYMENT_TYPES = ['debit', 'credit', 'pix', 'pix_installment'];
const transactionSchema = z.object({
  name: z.string({ error: 'Nome da transação é obrigatório.' }).trim().min(1, 'Nome da transação é obrigatório.'),
  category: z.string({ error: 'Categoria é obrigatória.' }).trim().min(1, 'Categoria é obrigatória.'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD.'),
  amount: z.coerce.number().int('Valor deve ser um inteiro em centavos.'),
  accountId: accountIdField,
  paymentType: z.enum(PAYMENT_TYPES).optional(),
  externalId: z.string().trim().min(1).optional(), // FITID do OFX — ver computeImportHash
  // Sem `currency`: a moeda de uma transação é sempre a da conta, derivada pelo servidor
  // (FIN-074). Um `currency` enviado pelo cliente é descartado pelo Zod, como todo campo extra.
});
const transactionBatchSchema = z.object({
  transactions: z.array(transactionSchema).min(1, 'Nenhuma transação enviada.'),
});
const transactionUpdateSchema = transactionSchema.partial();

const DEBT_CATEGORIES = ['Empréstimo', 'Financiamento', 'Cartão de Crédito', 'Pessoal', 'Outros'];
const debtItemSchema = z.object({
  name: z.string().trim().min(1),
  amount: z.coerce.number().int(),
  date: z.string().trim().min(1),
});
const debtSchema = z.object({
  name: z.string({ error: 'Nome da dívida é obrigatório.' }).trim().min(1, 'Nome da dívida é obrigatório.'),
  description: z.string().trim().nullable().optional(),
  category: z.enum(DEBT_CATEGORIES, { message: `Categoria deve ser uma de: ${DEBT_CATEGORIES.join(', ')}.` }),
  totalAmount: z.coerce.number().int('Valor total deve ser um inteiro em centavos.').min(0, 'Valor total não pode ser negativo.'),
  paidAmount: z.coerce.number().int('Valor pago deve ser um inteiro em centavos.').min(0, 'Valor pago não pode ser negativo.').optional(),
  monthlyPayment: z.coerce.number().int('Parcela mensal deve ser um inteiro em centavos.').min(0, 'Parcela mensal não pode ser negativa.'),
  totalInstallments: z.coerce.number().int().min(1, 'Deve haver ao menos 1 parcela.'),
  paidInstallments: z.coerce.number().int().min(0, 'Parcelas pagas não pode ser negativo.').optional(),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de vencimento deve estar no formato YYYY-MM-DD.'),
  interestRate: z.coerce.number().finite().nullable().optional(), // % ao mês, não é dinheiro
  accountId: accountIdField,
  subItems: z.array(debtItemSchema).optional(),
});
const debtUpdateSchema = debtSchema.partial();

// FIN-042/FIN-043 — orçamento mensal por categoria (Fase 3). `category` é texto livre
// (não um enum fechado, ao contrário de `debtSchema.category`) porque precisa casar com a
// categoria de qualquer transação — inclusive categorias digitadas manualmente pelo
// usuário na importação, que não pertencem a uma lista fixa (ver `CATEGORY_COLORS` em
// App.tsx e `CATEGORY_RULES` em parsers.ts). `monthlyLimit` exige > 0: um orçamento de
// R$0 não tem sentido de negócio e, sem essa validação, `computeBudgetProgress`
// (src/utils/budget.ts) precisaria tratar divisão por zero.
const budgetSchema = z.object({
  category: z.string({ error: 'Categoria é obrigatória.' }).trim().min(1, 'Categoria é obrigatória.'),
  monthlyLimit: z.coerce.number().int('Limite mensal deve ser um inteiro em centavos.').min(1, 'Limite mensal deve ser maior que zero.'),
});
const budgetUpdateSchema = budgetSchema.partial();
// FIN-049/FIN-050 — metas financeiras (Fase 4). `targetAmount` exige > 0: uma meta de R$0
// não tem sentido de negócio e tornaria o cálculo de progresso uma divisão por zero.
// `currentAmount` é opcional no create (nasce em 0) para que o mesmo schema sirva de base
// ao `partial()` usado no update — mesmo padrão de `paidAmount` em `debtSchema`.
const goalSchema = z.object({
  name: z.string({ error: 'Nome da meta é obrigatório.' }).trim().min(1, 'Nome da meta é obrigatório.'),
  targetAmount: z.coerce.number().int('Valor da meta deve ser um inteiro em centavos.').min(1, 'Valor da meta deve ser maior que zero.'),
  currentAmount: z.coerce.number().int('Valor acumulado deve ser um inteiro em centavos.').min(0, 'Valor acumulado não pode ser negativo.').optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data-alvo deve estar no formato YYYY-MM-DD.'),
});
const goalUpdateSchema = goalSchema.partial();

// FIN-053/FIN-054 — transações recorrentes (Fase 4). `amount` segue a convenção de
// `Transaction`: negativo = despesa, positivo = receita — e não pode ser 0, que geraria
// lançamentos sem efeito nenhum a cada ocorrência.
const RECURRENCE_FREQUENCIES = ['weekly', 'monthly', 'yearly'];
const recurringSchema = z.object({
  name: z.string({ error: 'Nome da recorrência é obrigatório.' }).trim().min(1, 'Nome da recorrência é obrigatório.'),
  category: z.string({ error: 'Categoria é obrigatória.' }).trim().min(1, 'Categoria é obrigatória.'),
  amount: z.coerce.number().int('Valor deve ser um inteiro em centavos.').refine(v => v !== 0, 'Valor não pode ser zero.'),
  frequency: z.enum(RECURRENCE_FREQUENCIES, { message: `Frequência deve ser uma de: ${RECURRENCE_FREQUENCIES.join(', ')}.` }),
  nextOccurrence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Próxima ocorrência deve estar no formato YYYY-MM-DD.'),
  accountId: accountIdField,
  active: z.boolean().optional(),
});
const recurringUpdateSchema = recurringSchema.partial();

// FIN-070/FIN-071 — carteira de investimentos (Fase 7). Os dois valores aceitam 0: uma posição
// recebida sem custo (bonificação em ações, cripto de presente) não tem valor aplicado, e uma
// que perdeu tudo vale 0 — são estados reais, não erro de digitação. Negativo não existe.
// O vínculo com a conta é conferido na rota (`investmentAccountError`), porque depende do banco.
const INVESTMENT_TYPES = ['fixed_income', 'stocks', 'funds', 'crypto', 'other'];
const investmentSchema = z.object({
  name: z.string({ error: 'Nome do investimento é obrigatório.' }).trim().min(1, 'Nome do investimento é obrigatório.'),
  type: z.enum(INVESTMENT_TYPES, { message: `Tipo de investimento deve ser um de: ${INVESTMENT_TYPES.join(', ')}.` }),
  amountInvested: z.coerce.number().int('Valor aplicado deve ser um inteiro em centavos.').min(0, 'Valor aplicado não pode ser negativo.'),
  currentValue: z.coerce.number().int('Valor atual deve ser um inteiro em centavos.').min(0, 'Valor atual não pode ser negativo.'),
  accountId: accountIdField,
  currency: currencyField, // FIN-074 — ausente no cadastro = real (padrão do banco)
});
const investmentUpdateSchema = investmentSchema.partial();


// Middleware de autenticação
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Acesso negado: Token ausente' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Acesso negado: Token inválido' });
    req.user = user;
    next();
  });
};

/* -------------------------------------------------------------------------- */
/*                               AUTH ROUTES                                  */
/* -------------------------------------------------------------------------- */

// Prazo de expiração do token JWT. Reduzido de 7d para 24h (ver FIN-012 em
// docs/BACKLOG_DETAIL.md) — não existe blocklist/refresh token nesta versão; um token
// vazado continua válido até expirar. Mitigação completa (revogação server-side) fica
// registrada como item de roadmap futuro, não implementada agora.
const JWT_EXPIRES_IN = '24h';

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { name, password } = req.body;
  // Normaliza o e-mail (trim + lowercase) antes de checar unicidade e salvar — sem isso,
  // "Usuario@Gmail.com" e "usuario@gmail.com" eram tratados como contas diferentes
  // (ver FIN-013 em docs/BACKLOG_DETAIL.md).
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : req.body.email;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Nome completo é obrigatório.' });
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'E-mail inválido.' });
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'A senha deve conter no mínimo 6 caracteres.' });
  }

  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    // Decisão registrada (ver FIN-014 em docs/BACKLOG_DETAIL.md): mantemos a mensagem
    // específica "Email já cadastrado" — é necessária para o UX de registro e o risco de
    // enumeração é baixo (não vaza dado sensível além de "existe conta"), já mitigado
    // pelo rate limit de FIN-007 acima.
    if (existingUser) return res.status(400).json({ error: 'Email já cadastrado.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, passwordHash },
    });

    const token = jwt.sign({ userId: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    sendInternalError(res, error, 'Erro ao criar usuário.');
  }
});

/* -------------------------------------------------------------------------- */
/*                 VERIFICAÇÃO EM DUAS ETAPAS — TOTP (FIN-078)                 */
/* -------------------------------------------------------------------------- */
// Códigos de 6 dígitos que mudam a cada 30 s (RFC 6238), compatíveis com Google Authenticator,
// Microsoft Authenticator, Authy, 1Password etc. Aceita também o intervalo anterior e o seguinte
// (±30 s), para tolerar o relógio do celular um pouco adiantado ou atrasado.
const TOTP_ISSUER = 'FinFlow';
const TOTP_WINDOW = 1;
const TOTP_CODE_PATTERN = /^\d{6}$/;
// Códigos de recuperação: entram no lugar do aplicativo quando o celular se perde, uma vez cada.
// Sem I, O, 0 e 1, que se confundem ao copiar à mão; 32 símbolos = 5 bits por caractere, então
// 10 caracteres = 50 bits. Guardados com bcrypt, e não sha256: com 50 bits, um hash rápido seria
// quebrável por força bruta em quem copiasse o banco.
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 10;
const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const TWO_FACTOR_UNAVAILABLE = 'A verificação em duas etapas não está configurada neste servidor.';
const TWO_FACTOR_ALREADY_ENABLED = 'A verificação em duas etapas já está ativa.';
const INVALID_SECOND_FACTOR = 'Código de verificação inválido.';

let twoFactorKeyWarned = false;

/**
 * Chave AES-256 que cifra os segredos TOTP no banco, derivada (HKDF) de
 * TWO_FACTOR_ENCRYPTION_KEY. Sem a variável — ou com menos de 32 caracteres —, a ativação fica
 * indisponível: gravar o segredo em texto puro deixaria qualquer cópia do banco gerar os códigos.
 * É uma chave própria, e não derivada do JWT_SECRET, para que trocar o JWT_SECRET (a resposta a
 * um token vazado) não invalide o 2FA de todos. Lida a cada uso, e não só no carregamento do
 * módulo, para os testes poderem simular um servidor sem a chave.
 */
function twoFactorKey() {
  const raw = process.env.TWO_FACTOR_ENCRYPTION_KEY || '';
  if (raw.length >= 32) return Buffer.from(crypto.hkdfSync('sha256', raw, '', 'finflow-2fa-secret', 32));
  if (raw && !twoFactorKeyWarned) {
    console.warn('⚠️  TWO_FACTOR_ENCRYPTION_KEY tem menos de 32 caracteres e foi ignorada — verificação em duas etapas indisponível.');
    twoFactorKeyWarned = true;
  }
  return null;
}

// Formato gravado: "v1.<iv>.<tag>.<cifrado>", em base64url. O `userId` entra como dado
// autenticado (AAD): o segredo de um usuário copiado para a linha de outro não decifra. A tag
// tem tamanho fixo de 16 bytes na decifragem — sem isso o Node aceitaria tags truncadas.
function encryptTwoFactorSecret(plain, userId, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(userId, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

/** Decifra o segredo TOTP; `null` quando a chave falta, mudou, ou o valor foi adulterado. */
function decryptTwoFactorSecret(payload, userId, key) {
  if (!key || typeof payload !== 'string') return null;
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const [, iv, tag, data] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), { authTagLength: 16 });
    decipher.setAAD(Buffer.from(userId, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Gerador TOTP do segredo (base32). O `label` só aparece no QR code — não afeta a validação. */
function buildTotp(secretBase32, label = '') {
  return new OTPAuth.TOTP({ issuer: TOTP_ISSUER, label, secret: OTPAuth.Secret.fromBase32(secretBase32) });
}

/** QR code do `otpauth://` como imagem (data URL), para o aplicativo autenticador ler. */
function qrCodeDataUrl(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(4, 4);
}

function generateRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    let code = '';
    for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) {
      code += RECOVERY_CODE_ALPHABET[crypto.randomInt(RECOVERY_CODE_ALPHABET.length)];
    }
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

/** Forma canônica do código de recuperação: maiúsculas, sem espaços nem hífens. */
function normalizeRecoveryCode(input) {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

/** Hashes dos códigos de recuperação restantes; um valor corrompido vale como lista vazia. */
function parseRecoveryHashes(stored) {
  try {
    const list = JSON.parse(stored);
    return Array.isArray(list) ? list.filter(hash => typeof hash === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Confere o segundo fator de um `UserTwoFactor` ativo — código de 6 dígitos do aplicativo ou
 * código de recuperação — e consome o que foi usado: o intervalo TOTP passa a ser o
 * `lastUsedStep`, e o código de recuperação sai da lista. O consumo é um `updateMany`
 * condicionado ao valor que acabou de ser lido, então duas requisições simultâneas com o mesmo
 * código não passam as duas. Devolve `{ ok: true, method, remaining? }` ou `{ ok: false, reason }`.
 */
async function consumeSecondFactor(record, rawCode) {
  const code = typeof rawCode === 'string' ? rawCode.replace(/\s/g, '') : '';

  if (TOTP_CODE_PATTERN.test(code)) {
    const secret = decryptTwoFactorSecret(record.secret, record.userId, twoFactorKey());
    if (!secret) {
      console.error(`2FA: o segredo do usuário ${record.userId} não pôde ser decifrado (TWO_FACTOR_ENCRYPTION_KEY ausente ou trocada).`);
      return { ok: false, reason: 'undecryptable' };
    }
    const totp = buildTotp(secret);
    const timestamp = Date.now();
    const delta = totp.validate({ token: code, timestamp, window: TOTP_WINDOW });
    if (delta === null) return { ok: false, reason: 'invalid' };
    const step = totp.counter({ timestamp }) + delta;
    const result = await prisma.userTwoFactor.updateMany({
      where: { userId: record.userId, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] },
      data: { lastUsedStep: step },
    });
    return result.count === 1 ? { ok: true, method: 'totp' } : { ok: false, reason: 'invalid' };
  }

  const normalized = normalizeRecoveryCode(code);
  if (normalized.length !== RECOVERY_CODE_LENGTH) return { ok: false, reason: 'invalid' };
  const hashes = parseRecoveryHashes(record.recoveryCodes);
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(normalized, hashes[i])) {
      const remaining = hashes.filter((_, j) => j !== i);
      const result = await prisma.userTwoFactor.updateMany({
        where: { userId: record.userId, recoveryCodes: record.recoveryCodes },
        data: { recoveryCodes: JSON.stringify(remaining) },
      });
      return result.count === 1
        ? { ok: true, method: 'recovery', remaining: remaining.length }
        : { ok: false, reason: 'invalid' };
    }
  }
  return { ok: false, reason: 'invalid' };
}

/** Mensagem de um segundo fator recusado. Sem a chave, só os códigos de recuperação funcionam. */
function secondFactorError(reason) {
  return reason === 'undecryptable'
    ? 'Não foi possível validar o código do aplicativo neste servidor. Use um código de recuperação.'
    : INVALID_SECOND_FACTOR;
}

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { password } = req.body;
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : req.body.email;

  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'E-mail é obrigatório.' });
  }
  if (!password || typeof password !== 'string' || !password.trim()) {
    return res.status(400).json({ error: 'Senha é obrigatória.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email }, include: { twoFactor: true } });
    if (!user) return res.status(400).json({ error: 'Credenciais inválidas' });

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) return res.status(400).json({ error: 'Credenciais inválidas' });

    // FIN-078 — com a verificação em duas etapas ativa, a senha certa não basta. Sem código, a
    // resposta pede o segundo fator (sem token); com código, ele precisa conferir. Só chega
    // aqui quem acertou a senha: a senha errada recebe a mesma mensagem de sempre, e nada
    // revela se a conta usa 2FA. Uma configuração iniciada e não confirmada não conta.
    let recoveryInfo = {};
    if (user.twoFactor?.enabledAt) {
      const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
      if (!code) return res.json({ twoFactorRequired: true });
      const check = await consumeSecondFactor(user.twoFactor, code);
      if (!check.ok) return res.status(400).json({ error: secondFactorError(check.reason) });
      if (check.method === 'recovery') {
        recoveryInfo = { recoveryCodeUsed: true, recoveryCodesRemaining: check.remaining };
      }
    }

    const token = jwt.sign({ userId: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email }, ...recoveryInfo });
  } catch (error) {
    sendInternalError(res, error, 'Erro ao realizar login.');
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  res.json({ user: req.user });
});

// FIN-078 — estado da verificação em duas etapas do usuário: se o servidor tem a chave para
// ativá-la (`available`), se está ativa e quantos códigos de recuperação restam.
app.get('/api/auth/2fa', authenticateToken, async (req, res) => {
  try {
    const record = await prisma.userTwoFactor.findUnique({ where: { userId: req.user.userId } });
    const enabled = Boolean(record?.enabledAt);
    res.json({
      available: twoFactorKey() !== null,
      enabled,
      enabledAt: enabled ? record.enabledAt : null,
      recoveryCodesRemaining: enabled ? parseRecoveryHashes(record.recoveryCodes).length : null,
    });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao consultar a verificação em duas etapas.');
  }
});

// Passo 1 da ativação: gera um segredo novo e devolve o QR code. Nada muda no login ainda —
// o registro nasce com `enabledAt` nulo e só vale depois de confirmado (passo 2).
app.post('/api/auth/2fa/setup', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const key = twoFactorKey();
  if (!key) return res.status(503).json({ error: TWO_FACTOR_UNAVAILABLE });
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    const data = { secret: encryptTwoFactorSecret(secret, userId, key), enabledAt: null, lastUsedStep: null, recoveryCodes: '[]' };
    // Recomeçar uma configuração pendente troca o segredo; uma já ativa, nunca. O
    // `enabledAt: null` no filtro vale também contra uma ativação feita em outra aba entre a
    // leitura e a escrita: sem registro pendente, cai no `create`, que esbarra no registro ativo.
    const updated = await prisma.userTwoFactor.updateMany({ where: { userId, enabledAt: null }, data });
    if (updated.count === 0) {
      try {
        await prisma.userTwoFactor.create({ data: { userId, ...data } });
      } catch (err) {
        if (err.code === 'P2002') return res.status(409).json({ error: TWO_FACTOR_ALREADY_ENABLED });
        throw err;
      }
    }

    const otpauthUrl = buildTotp(secret, user.email).toString();
    res.json({ secret, otpauthUrl, qrCode: qrCodeDataUrl(otpauthUrl) });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao iniciar a verificação em duas etapas.');
  }
});

// Passo 2: confirma com a senha e um código do aplicativo, e devolve os códigos de recuperação
// — a única vez em que aparecem em texto. A senha é exigida para que um token vazado não baste
// para ativar o 2FA com o celular de outra pessoa e trancar o dono fora da conta.
app.post('/api/auth/2fa/enable', authLimiter, authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { password } = req.body;
  const code = typeof req.body.code === 'string' ? req.body.code.replace(/\s/g, '') : '';
  if (typeof password !== 'string' || !password) return res.status(400).json({ error: 'Senha é obrigatória.' });
  if (!TOTP_CODE_PATTERN.test(code)) return res.status(400).json({ error: 'Informe o código de 6 dígitos do aplicativo.' });
  const key = twoFactorKey();
  if (!key) return res.status(503).json({ error: TWO_FACTOR_UNAVAILABLE });

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { twoFactor: true } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (!(await bcrypt.compare(password, user.passwordHash))) return res.status(400).json({ error: 'Senha incorreta.' });

    const record = user.twoFactor;
    if (record?.enabledAt) return res.status(409).json({ error: TWO_FACTOR_ALREADY_ENABLED });
    if (!record) return res.status(400).json({ error: 'Gere o QR code antes de confirmar.' });
    const secret = decryptTwoFactorSecret(record.secret, userId, key);
    if (!secret) return res.status(400).json({ error: 'Esta configuração não vale mais. Gere um novo QR code.' });

    const totp = buildTotp(secret);
    const timestamp = Date.now();
    const delta = totp.validate({ token: code, timestamp, window: TOTP_WINDOW });
    if (delta === null) return res.status(400).json({ error: INVALID_SECOND_FACTOR });

    const recoveryCodes = generateRecoveryCodes();
    const hashes = await Promise.all(recoveryCodes.map(c => bcrypt.hash(normalizeRecoveryCode(c), 10)));
    // `secret` no filtro: se outra aba gerou um QR code novo depois da leitura, o código
    // conferido é de um segredo que já não vale, e a ativação não acontece.
    const result = await prisma.userTwoFactor.updateMany({
      where: { userId, enabledAt: null, secret: record.secret },
      data: { enabledAt: new Date(), lastUsedStep: totp.counter({ timestamp }) + delta, recoveryCodes: JSON.stringify(hashes) },
    });
    if (result.count === 0) return res.status(409).json({ error: 'A configuração mudou em outra janela. Gere um novo QR code.' });
    res.json({ enabled: true, recoveryCodes });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao ativar a verificação em duas etapas.');
  }
});

// Desativa com a senha e um segundo fator (código do aplicativo ou de recuperação) — quem só
// tem o token, ou só a senha, não consegue tirar a proteção.
app.post('/api/auth/2fa/disable', authLimiter, authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { password, code } = req.body;
  if (typeof password !== 'string' || !password) return res.status(400).json({ error: 'Senha é obrigatória.' });
  if (typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({ error: 'Informe um código do aplicativo ou um código de recuperação.' });
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { twoFactor: true } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (!(await bcrypt.compare(password, user.passwordHash))) return res.status(400).json({ error: 'Senha incorreta.' });
    if (!user.twoFactor?.enabledAt) return res.status(409).json({ error: 'A verificação em duas etapas não está ativa.' });

    const check = await consumeSecondFactor(user.twoFactor, code);
    if (!check.ok) return res.status(400).json({ error: secondFactorError(check.reason) });
    await prisma.userTwoFactor.deleteMany({ where: { userId } });
    res.json({ enabled: false });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao desativar a verificação em duas etapas.');
  }
});

/* -------------------------------------------------------------------------- */
/*                           DATA CRUD ROUTES                                 */
/* -------------------------------------------------------------------------- */

// --- ACCOUNTS ---
app.get('/api/accounts', authenticateToken, async (req, res) => {
  try {
    const accounts = await prisma.account.findMany({ where: { userId: req.user.userId } });
    res.json(accounts);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar contas.');
  }
});

app.post('/api/accounts', authenticateToken, async (req, res) => {
  const validation = validateBody(accountSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const data = { ...validation.data, userId: req.user.userId };
    const acc = await prisma.account.create({ data });
    res.json(acc);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao criar conta.');
  }
});

app.put('/api/accounts/:id', authenticateToken, async (req, res) => {
  const validation = validateBody(accountUpdateSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const { currency } = validation.data;
    // FIN-074: as transações de uma conta estão sempre na moeda dela, então trocar a moeda da
    // conta (em geral, corrigir um cadastro errado) leva as transações junto — na mesma
    // transação de banco, para nunca ficar metade numa moeda e metade na outra. Os valores não
    // são convertidos: a troca corrige o rótulo, não faz câmbio. A posse da conta é conferida
    // antes, para não mexer em transações do usuário apontadas para a conta de outra pessoa.
    const owned = currency
      ? await prisma.account.findFirst({ where: { id, userId }, select: { id: true } })
      : null;
    const [acc] = await prisma.$transaction([
      prisma.account.updateMany({ where: { id, userId }, data: validation.data }),
      ...(owned ? [prisma.transaction.updateMany({ where: { userId, accountId: id }, data: { currency } })] : []),
    ]);
    res.json({ success: true, changes: acc.count });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao atualizar conta.');
  }
});

app.delete('/api/accounts/:id', authenticateToken, async (req, res) => {
  try {
    await prisma.account.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir conta.');
  }
});

// --- TRANSACTIONS ---
// Paginação real via `?page=`/`?pageSize=` (ver FIN-023) — opcional e aditiva: sem esses
// parâmetros, mantém o comportamento original (array simples, limitado a 2000) para não
// quebrar os callers existentes (carga inicial do dashboard, que soma todas as transações
// para `stats`, e o reload após import/sync). Com os parâmetros, retorna um objeto
// `{ transactions, total, page, pageSize }`, usado pelo frontend para "carregar mais"
// além do limite de 2000.
app.get('/api/transactions', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    if (req.query.page === undefined && req.query.pageSize === undefined) {
      const txs = await prisma.transaction.findMany({
        where: { userId },
        orderBy: { date: 'desc' },
        take: 2000
      });
      return res.json(txs);
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(2000, Math.max(1, parseInt(req.query.pageSize, 10) || 200));
    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId },
        orderBy: { date: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.transaction.count({ where: { userId } }),
    ]);
    res.json({ transactions, total, page, pageSize });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar transações.');
  }
});

/**
 * FIN-074 — moeda de cada conta do usuário entre `accountIds`, para derivar a moeda das
 * transações: uma transação fica sempre na moeda da conta vinculada (em real, sem conta). Uma
 * conta que não é do usuário não entra no mapa, e a transação fica em real — conferir a posse do
 * `accountId` nas rotas de transação é assunto de FIN-096.
 */
async function accountCurrencies(userId, accountIds) {
  const ids = [...new Set(accountIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const accounts = await prisma.account.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true, currency: true },
  });
  return new Map(accounts.map(a => [a.id, a.currency]));
}

/** Moeda de uma transação ligada a `accountId`, a partir do mapa de `accountCurrencies`. */
function currencyForAccount(currencies, accountId) {
  return (accountId && currencies.get(accountId)) || BASE_CURRENCY;
}

app.post('/api/transactions', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  // Supports batch insert
  if (Array.isArray(req.body.transactions)) {
    const validation = validateBody(transactionBatchSchema, req.body);
    if (!validation.ok) return res.status(400).json({ error: validation.message });
    try {
      // Deduplicação aplicada linha a linha via `create` + constraint única
      // `@@unique([userId, importHash])` (ver FIN-021/schema.prisma), não mais um
      // pré-filtro em memória (findMany + Set) seguido de `createMany`: aquele padrão
      // tinha uma janela de corrida — duas importações do mesmo arquivo disparadas em
      // paralelo (ex. duplo clique) podiam ambas passar pela checagem antes de gravar e
      // duplicar as transações, o mesmo problema já corrigido para o sync Pluggy em
      // FIN-021. Criar linha a linha e capturar o erro de constraint (P2002) é mais
      // lento que um `createMany` em lote, mas é atômico a nível de banco — inclusive
      // para duplicatas dentro do próprio arquivo importado (mesma linha repetida).
      // `acceptedIndices` (posição no array original enviado) permite ao frontend saber
      // exatamente quais transações entraram, sem reimplementar o hash (ver FIN-004).
      const acceptedIndices = [];
      let skipped = 0;
      // FIN-074: cada transação fica na moeda da conta em que é importada.
      const currencies = await accountCurrencies(userId, validation.data.transactions.map(t => t.accountId));
      for (let i = 0; i < validation.data.transactions.length; i++) {
        const { externalId, ...t } = validation.data.transactions[i];
        const data = { ...t, userId, currency: currencyForAccount(currencies, t.accountId) };
        data.importHash = computeImportHash(userId, { ...t, externalId });
        try {
          await prisma.transaction.create({ data });
          acceptedIndices.push(i);
        } catch (err) {
          if (err.code === 'P2002') { skipped++; continue; }
          throw err;
        }
      }
      res.json({ success: true, count: acceptedIndices.length, skipped, acceptedIndices });
    } catch (err) {
      sendInternalError(res, err, 'Erro ao importar transações.');
    }
  } else {
    const validation = validateBody(transactionSchema, req.body);
    if (!validation.ok) return res.status(400).json({ error: validation.message });
    try {
      const { externalId: _externalId, ...rest } = validation.data;
      const currencies = await accountCurrencies(userId, [rest.accountId]);
      const data = { ...rest, userId, currency: currencyForAccount(currencies, rest.accountId) };
      const tx = await prisma.transaction.create({ data });
      res.json(tx);
    } catch (err) {
      sendInternalError(res, err, 'Erro ao criar transação.');
    }
  }
});

app.delete('/api/transactions/bulk', authenticateToken, async (req, res) => {
  try {
    await prisma.transaction.deleteMany({ where: { userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir transações.');
  }
});

// Registradas depois de `/bulk` — Express casa rotas na ordem de registro, e `/:id`
// capturaria "bulk" como id se viesse antes (ver FIN-022).
app.put('/api/transactions/:id', authenticateToken, async (req, res) => {
  const validation = validateBody(transactionUpdateSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const { externalId: _externalId, ...data } = validation.data;
    // FIN-074: trocar a conta troca a moeda junto — a transação segue na moeda da conta, e em
    // real quando desvinculada (`accountId` nulo).
    if (data.accountId !== undefined) {
      const currencies = await accountCurrencies(req.user.userId, [data.accountId]);
      data.currency = currencyForAccount(currencies, data.accountId);
    }
    const result = await prisma.transaction.updateMany({
      where: { id: req.params.id, userId: req.user.userId },
      data,
    });
    res.json({ success: true, changes: result.count });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao atualizar transação.');
  }
});

app.delete('/api/transactions/:id', authenticateToken, async (req, res) => {
  try {
    await prisma.transaction.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir transação.');
  }
});

// --- DEBTS ---
app.get('/api/debts', authenticateToken, async (req, res) => {
  try {
    const debts = await prisma.debt.findMany({
      where: { userId: req.user.userId },
      include: { subItems: true }
    });
    res.json(debts);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar dívidas.');
  }
});

app.post('/api/debts', authenticateToken, async (req, res) => {
  const validation = validateBody(debtSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const { subItems, ...rest } = validation.data;
    // paidAmount/paidInstallments são opcionais no schema (para não forçar reset a 0 em
    // updates parciais via debtUpdateSchema, que reaproveita o mesmo schema base) — mas
    // no create, se ausentes, uma dívida nova sempre começa em 0.
    const data = { paidAmount: 0, paidInstallments: 0, ...rest, userId: req.user.userId };

    const debt = await prisma.debt.create({
      data: {
        ...data,
        subItems: subItems ? { create: subItems.map(s => ({ name: s.name, amount: s.amount, date: s.date })) } : undefined
      },
      include: { subItems: true }
    });
    res.json(debt);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao criar dívida.');
  }
});

app.put('/api/debts/:id', authenticateToken, async (req, res) => {
  const validation = validateBody(debtUpdateSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const { id } = req.params;
    const { subItems: _subItems, ...data } = validation.data;

    const debt = await prisma.debt.update({
      where: { id, userId: req.user.userId },
      data,
      include: { subItems: true }
    });
    res.json(debt);
  } catch (err) {
    // P2025 = nenhum registro encontrado com esse `where` (id + userId) — ou a dívida não
    // existe, ou pertence a outro usuário. Mesmo comportamento de "não encontrado" que
    // accounts/transactions dão via updateMany (changes:0), só que aqui `update` lança em
    // vez de simplesmente não afetar linhas — sem este catch, cairia em 500 (ver FIN-032).
    if (err.code === 'P2025') return res.status(404).json({ error: 'Dívida não encontrada.' });
    sendInternalError(res, err, 'Erro ao atualizar dívida.');
  }
});

app.delete('/api/debts/:id', authenticateToken, async (req, res) => {
  try {
    // Delete subitems first via cascading or manual delete due to sqlite limitations if not setup
    await prisma.debtItem.deleteMany({ where: { debt: { id: req.params.id, userId: req.user.userId } }});
    await prisma.debt.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir dívida.');
  }
});

// --- BUDGETS (FIN-043) ---
app.get('/api/budgets', authenticateToken, async (req, res) => {
  try {
    const budgets = await prisma.budget.findMany({ where: { userId: req.user.userId } });
    res.json(budgets);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar orçamentos.');
  }
});

app.post('/api/budgets', authenticateToken, async (req, res) => {
  const validation = validateBody(budgetSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const data = { ...validation.data, userId: req.user.userId };
    const budget = await prisma.budget.create({ data });
    res.json(budget);
  } catch (err) {
    // P2002 = violação da constraint única (userId, category) — ver FIN-042. Mensagem
    // específica em vez de 500 genérico, já que é um erro de uso esperado (o usuário já
    // tem um orçamento para esta categoria e deveria editá-lo em vez de criar outro).
    if (err.code === 'P2002') return res.status(400).json({ error: 'Já existe um orçamento para esta categoria. Edite o orçamento existente.' });
    sendInternalError(res, err, 'Erro ao criar orçamento.');
  }
});

app.put('/api/budgets/:id', authenticateToken, async (req, res) => {
  const validation = validateBody(budgetUpdateSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const { id } = req.params;
    const budget = await prisma.budget.updateMany({
      where: { id, userId: req.user.userId },
      data: validation.data,
    });
    res.json({ success: true, changes: budget.count });
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ error: 'Já existe um orçamento para esta categoria.' });
    sendInternalError(res, err, 'Erro ao atualizar orçamento.');
  }
});

app.delete('/api/budgets/:id', authenticateToken, async (req, res) => {
  try {
    await prisma.budget.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });

    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir orçamento.');
  }
});

// --- GOALS (FIN-050) ---
app.get('/api/goals', authenticateToken, async (req, res) => {
  try {
    const goals = await prisma.goal.findMany({ where: { userId: req.user.userId } });
    res.json(goals);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar metas.');
  }
});

app.post('/api/goals', authenticateToken, async (req, res) => {
  const validation = validateBody(goalSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    // `currentAmount` é opcional no schema (para servir ao update parcial); no create, uma
    // meta nova sempre começa em 0 quando não informado.
    const data = { currentAmount: 0, ...validation.data, userId: req.user.userId };
    const goal = await prisma.goal.create({ data });
    res.json(goal);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao criar meta.');
  }
});

app.put('/api/goals/:id', authenticateToken, async (req, res) => {
  const validation = validateBody(goalUpdateSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const goal = await prisma.goal.updateMany({
      where: { id: req.params.id, userId: req.user.userId },
      data: validation.data,
    });
    res.json({ success: true, changes: goal.count });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao atualizar meta.');
  }
});

app.delete('/api/goals/:id', authenticateToken, async (req, res) => {
  try {
    await prisma.goal.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir meta.');
  }
});

// --- INVESTMENTS (FIN-071) ---
/**
 * Confere o `accountId` informado para um investimento: a conta precisa existir, ser do
 * próprio usuário e não ser um cartão de crédito. A chave estrangeira só garante que a conta
 * existe — sem esta checagem, o id de uma conta de outro usuário seria aceito e o investimento
 * ficaria vinculado a ela. E cartão não guarda aplicação: o saldo dele é uma fatura.
 * Devolve a mensagem de erro, ou `null` quando o vínculo é válido ou não foi informado.
 */
async function investmentAccountError(userId, accountId) {
  if (!accountId) return null;
  const account = await prisma.account.findFirst({ where: { id: accountId, userId }, select: { type: true } });
  if (!account) return 'Conta vinculada não encontrada.';
  if (account.type === 'credit') return 'Um investimento não pode ser vinculado a um cartão de crédito.';
  return null;
}

app.get('/api/investments', authenticateToken, async (req, res) => {
  try {
    const investments = await prisma.investment.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'asc' },
    });
    res.json(investments);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar investimentos.');
  }
});

app.post('/api/investments', authenticateToken, async (req, res) => {
  const validation = validateBody(investmentSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  const userId = req.user.userId;
  try {
    const accountError = await investmentAccountError(userId, validation.data.accountId);
    if (accountError) return res.status(400).json({ error: accountError });
    const investment = await prisma.investment.create({ data: { ...validation.data, userId } });
    res.json(investment);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao criar investimento.');
  }
});

app.put('/api/investments/:id', authenticateToken, async (req, res) => {
  const validation = validateBody(investmentUpdateSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  const userId = req.user.userId;
  try {
    const accountError = await investmentAccountError(userId, validation.data.accountId);
    if (accountError) return res.status(400).json({ error: accountError });
    // `update`, e não `updateMany`, para devolver o registro com o `updatedAt` novo — a
    // carteira mostra há quanto tempo cada valor foi atualizado. O `userId` no `where`
    // garante o isolamento: id inexistente ou de outro usuário cai no P2025 (404), como em
    // /api/debts/:id.
    const investment = await prisma.investment.update({
      where: { id: req.params.id, userId },
      data: validation.data,
    });
    res.json(investment);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Investimento não encontrado.' });
    sendInternalError(res, err, 'Erro ao atualizar investimento.');
  }
});

app.delete('/api/investments/:id', authenticateToken, async (req, res) => {
  try {
    await prisma.investment.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir investimento.');
  }
});

// --- EXCHANGE RATES (FIN-075) ---
// O frontend pede só as moedas em uso (`?symbols=USD,EUR`) e recebe quantos reais vale 1
// unidade de cada. Moeda que o provedor não cota simplesmente não vem na resposta — o frontend
// deixa os itens dela fora dos totais e avisa. `stale: true` = cotação antiga, servida porque a
// atualização falhou. Autenticada para não virar um proxy aberto do provedor.
const MAX_EXCHANGE_SYMBOLS = 20;

app.get('/api/exchange-rates', authenticateToken, async (req, res) => {
  const raw = typeof req.query.symbols === 'string' ? req.query.symbols : '';
  const symbols = [...new Set(raw.split(',').map(code => code.trim().toUpperCase()).filter(Boolean))];
  if (symbols.length === 0 || symbols.length > MAX_EXCHANGE_SYMBOLS || !symbols.every(code => CURRENCY_CODE_PATTERN.test(code))) {
    return res.status(400).json({
      error: `Informe em "symbols" até ${MAX_EXCHANGE_SYMBOLS} códigos de moeda ISO, separados por vírgula (ex.: USD,EUR).`,
    });
  }
  try {
    const { date, rates, stale } = await getExchangeRates();
    const picked = {};
    for (const code of symbols) {
      if (code === BASE_CURRENCY) picked[code] = 1;
      else if (Object.prototype.hasOwnProperty.call(rates, code)) picked[code] = rates[code];
    }
    res.json({ base: BASE_CURRENCY, date, rates: picked, stale });
  } catch (err) {
    // O detalhe fica no log: a resposta não repete a mensagem do provedor (FIN-011).
    console.error('Falha ao obter cotações de câmbio:', err);
    res.status(502).json({ error: 'Cotações indisponíveis no momento. Tente novamente mais tarde.' });
  }
});

// --- RECURRING TRANSACTIONS (FIN-054) ---
app.get('/api/recurring-transactions', authenticateToken, async (req, res) => {
  try {
    const recurring = await prisma.recurringTransaction.findMany({ where: { userId: req.user.userId } });
    res.json(recurring);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar recorrências.');
  }
});

app.post('/api/recurring-transactions', authenticateToken, async (req, res) => {
  const validation = validateBody(recurringSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const data = { active: true, ...validation.data, userId: req.user.userId };
    const recurring = await prisma.recurringTransaction.create({ data });
    res.json(recurring);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao criar recorrência.');
  }
});

/*
 * Lança as ocorrências já vencidas de todas as recorrências ativas do usuário, criando as
 * `Transaction` reais e avançando `nextOccurrence`. Declarado ANTES das rotas com `:id`
 * para que "process" nunca seja capturado como um id.
 *
 * Idempotente por construção: cada ocorrência tem um `importHash` determinístico
 * (`recurringOccurrenceHash`) protegido pela constraint única `(userId, importHash)`, e a
 * criação das transações + o avanço do ponteiro acontecem na mesma transação de banco —
 * então nunca fica uma transação lançada sem o ponteiro correspondente ter avançado, nem o
 * contrário.
 */
app.post('/api/recurring-transactions/process', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const today = todayISO();
    // Comparação de data em string ISO (YYYY-MM-DD) é lexicográfica = cronológica, mesma
    // convenção usada em `isDebtOverdue` no frontend.
    const dueRecurrences = await prisma.recurringTransaction.findMany({
      where: { userId, active: true, nextOccurrence: { lte: today } },
      // FIN-074: a ocorrência nasce na moeda da conta da recorrência (real, sem conta).
      include: { account: { select: { currency: true } } },
    });

    let processed = 0;
    for (const rec of dueRecurrences) {
      const ops = [];
      let occurrence = rec.nextOccurrence;

      while (occurrence <= today && ops.length < MAX_OCCURRENCES_PER_RUN) {
        const importHash = recurringOccurrenceHash(userId, rec.id, occurrence);
        ops.push(prisma.transaction.upsert({
          where: { userId_importHash: { userId, importHash } },
          create: {
            userId,
            accountId: rec.accountId,
            name: rec.name,
            category: rec.category,
            date: occurrence,
            amount: rec.amount,
            currency: rec.account?.currency ?? BASE_CURRENCY,
            importHash,
          },
          // Ocorrência já lançada por uma execução anterior/concorrente: nada a fazer.
          update: {},
        }));

        const next = advanceOccurrence(occurrence, rec.frequency);
        // Proteção contra dado inesperado (frequência desconhecida, data malformada): sem
        // avanço, o laço giraria para sempre sobre a mesma ocorrência.
        if (next <= occurrence) break;
        occurrence = next;
      }

      if (ops.length === 0) continue;
      ops.push(prisma.recurringTransaction.update({
        where: { id: rec.id },
        data: { nextOccurrence: occurrence },
      }));
      await prisma.$transaction(ops);
      processed += ops.length - 1; // desconta o update do ponteiro
    }

    // `processed` conta ocorrências processadas nesta execução. Numa reexecução rara sobre
    // as mesmas ocorrências (upsert no-op), o número reflete o que foi reprocessado, não
    // transações novas — o frontend usa apenas "> 0" para decidir se recarrega a lista.
    res.json({ success: true, processed });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao processar recorrências.');
  }
});

app.put('/api/recurring-transactions/:id', authenticateToken, async (req, res) => {
  const validation = validateBody(recurringUpdateSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const recurring = await prisma.recurringTransaction.updateMany({
      where: { id: req.params.id, userId: req.user.userId },
      data: validation.data,
    });
    res.json({ success: true, changes: recurring.count });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao atualizar recorrência.');
  }
});

app.delete('/api/recurring-transactions/:id', authenticateToken, async (req, res) => {
  try {
    await prisma.recurringTransaction.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir recorrência.');
  }
});

// --- NOTIFICATIONS (FIN-065 a FIN-069) ---

// Quantas notificações a listagem devolve. A central mostra as mais recentes; o total de não
// lidas vem à parte (`unreadCount`), então o limite nunca esconde nada do contador do sino.
const NOTIFICATIONS_PAGE_SIZE = 50;

// Tipos cujo aviso deixa de valer quando a ocorrência sai de cena: a parcela foi paga, ou o
// "vence em" virou "venceu" (outro aviso, com outra chave). Faturas ficam de fora — não há
// como saber se foram pagas, então o aviso só sai do contador quando o usuário o lê — e os
// alertas de gasto incomum também, porque são informativos e valem para o mês inteiro.
const RECONCILED_NOTIFICATION_TYPES = ['debt_due', 'debt_overdue'];

app.get('/api/notifications', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: [{ read: 'asc' }, { createdAt: 'desc' }],
        take: NOTIFICATIONS_PAGE_SIZE,
      }),
      prisma.notification.count({ where: { userId, read: false } }),
    ]);
    res.json({ notifications, unreadCount });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar notificações.');
  }
});

/*
 * Gera as notificações automáticas — vencimentos (FIN-067) e gasto incomum (FIN-069) — a
 * partir do estado atual das dívidas, cartões e transações. O frontend chama ao carregar o
 * app e sempre que esses dados mudam. Declarado antes das rotas com `:id`, pelo mesmo motivo
 * de `/recurring-transactions/process`.
 *
 * Idempotente no banco: cada aviso tem uma `dedupeKey` protegida pela constraint única
 * `(userId, dedupeKey)`, e o upsert atualiza só título e mensagem — nunca `read`, para que um
 * aviso já lido não volte a acender o sino. Tudo numa transação, junto da reconciliação.
 */
app.post('/api/notifications/generate', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const today = todayISO();
    const settings = NOTIFICATION_SETTINGS;
    const baselineStart = `${shiftMonthKey(today.slice(0, 7), -settings.unusualSpendingMonths)}-01`;

    const [debts, creditAccounts, recentTransactions, firstTransaction] = await Promise.all([
      prisma.debt.findMany({ where: { userId } }),
      prisma.account.findMany({ where: { userId, type: 'credit' } }),
      // FIN-074: só transações em real — somar dólares e reais na mesma categoria distorceria a
      // média e o gasto do mês. Gasto em moeda estrangeira fica fora deste alerta.
      prisma.transaction.findMany({
        where: { userId, currency: BASE_CURRENCY, date: { gte: baselineStart, lte: today } },
        select: { date: true, amount: true, category: true },
      }),
      // O início do histórico decide quais meses da média estão completos — ver
      // `detectUnusualSpending`. Precisa ser o de TODAS as transações, não só as da janela.
      prisma.transaction.findFirst({ where: { userId }, orderBy: { date: 'asc' }, select: { date: true } }),
    ]);

    const candidates = [
      ...buildDueNotifications(debts, creditAccounts, today, settings.dueSoonDays),
      ...detectUnusualSpending(recentTransactions, today, {
        months: settings.unusualSpendingMonths,
        threshold: settings.unusualSpendingThreshold,
        minCents: settings.unusualSpendingMinCents,
        historyStart: firstTransaction?.date,
      }),
    ];

    await prisma.$transaction([
      ...candidates.map(candidate => prisma.notification.upsert({
        where: { userId_dedupeKey: { userId, dedupeKey: candidate.dedupeKey } },
        create: { userId, ...candidate },
        update: { title: candidate.title, message: candidate.message },
      })),
      // Reconciliação não destrutiva: marca como lidos (nunca apaga) os avisos de dívida cuja
      // ocorrência não está mais entre as candidatas — parcela paga, dívida quitada ou
      // excluída, ou "vence em" que virou "venceu". Sem isso o sino continuaria aceso por algo
      // que já foi resolvido.
      prisma.notification.updateMany({
        where: {
          userId,
          read: false,
          type: { in: RECONCILED_NOTIFICATION_TYPES },
          dedupeKey: { notIn: candidates.map(c => c.dedupeKey) },
        },
        data: { read: true },
      }),
    ]);

    res.json({ success: true, active: candidates.length });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao gerar notificações.');
  }
});

app.put('/api/notifications/read-all', authenticateToken, async (req, res) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user.userId, read: false },
      data: { read: true },
    });
    res.json({ success: true, changes: result.count });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao marcar notificações como lidas.');
  }
});

app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    // `userId` no filtro: a notificação de outro usuário simplesmente não é encontrada, e a
    // resposta é a mesma de um id inexistente — não revela que o id existe (ver FIN-032).
    const result = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user.userId },
      data: { read: true },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Notificação não encontrada.' });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao marcar notificação como lida.');
  }
});

/* -------------------------------------------------------------------------- */
/*                   BACKUP E RESTAURAÇÃO (FIN-079/FIN-080)                   */
/* -------------------------------------------------------------------------- */
// Arquivo: { format, version, exportedAt, user: { name, email }, data: { accounts, transactions,
// debts (com subItems), budgets, goals, recurring, investments } }, com os valores em centavos,
// como no banco. Ficam de fora a senha, a verificação em duas etapas (segredos não saem do
// servidor) e as notificações, que são derivadas dos dados e voltam a ser geradas. As linhas não
// levam `userId`: o arquivo não carrega a identidade interna de ninguém.
const BACKUP_FORMAT = 'finflow-backup';
const BACKUP_VERSION = 1;
// Limite do corpo da restauração — cerca de 100 mil transações cabem com folga.
const BACKUP_BODY_LIMIT = '25mb';
const MAX_BACKUP_ROWS = 100_000;
// Seções do arquivo, com o nome de cada registro no singular e no plural (mensagens de erro).
const BACKUP_SECTIONS = {
  accounts: ['conta', 'contas'],
  transactions: ['transação', 'transações'],
  debts: ['dívida', 'dívidas'],
  budgets: ['orçamento', 'orçamentos'],
  goals: ['meta', 'metas'],
  recurring: ['recorrência', 'recorrências'],
  investments: ['investimento', 'investimentos'],
};

async function buildBackup(userId) {
  // Numa única transação de leitura: o arquivo é um retrato consistente mesmo com um sync da
  // Pluggy gravando ao mesmo tempo. O `id` no fim de cada ordenação desempata registros criados
  // no mesmo milissegundo, para dois backups dos mesmos dados saírem idênticos.
  const byCreation = [{ createdAt: 'asc' }, { id: 'asc' }];
  const [user, accounts, transactions, debts, budgets, goals, recurring, investments] = await prisma.$transaction([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    prisma.account.findMany({ where: { userId }, orderBy: byCreation }),
    prisma.transaction.findMany({ where: { userId }, orderBy: [{ date: 'asc' }, ...byCreation] }),
    prisma.debt.findMany({
      where: { userId },
      orderBy: byCreation,
      include: { subItems: { orderBy: [{ date: 'asc' }, { name: 'asc' }, { amount: 'asc' }] } },
    }),
    prisma.budget.findMany({ where: { userId }, orderBy: byCreation }),
    prisma.goal.findMany({ where: { userId }, orderBy: byCreation }),
    prisma.recurringTransaction.findMany({ where: { userId }, orderBy: byCreation }),
    prisma.investment.findMany({ where: { userId }, orderBy: byCreation }),
  ]);
  if (!user) return null;
  const withoutUser = ({ userId: _userId, ...row }) => row;
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    user,
    data: {
      accounts: accounts.map(withoutUser),
      transactions: transactions.map(withoutUser),
      debts: debts.map(({ userId: _userId, subItems, ...debt }) => ({
        ...debt,
        subItems: subItems.map(({ name, amount, date }) => ({ name, amount, date })),
      })),
      budgets: budgets.map(withoutUser),
      goals: goals.map(withoutUser),
      recurring: recurring.map(withoutUser),
      investments: investments.map(withoutUser),
    },
  };
}

app.get('/api/account/export', authenticateToken, async (req, res) => {
  try {
    const backup = await buildBackup(req.user.userId);
    if (!backup) return res.status(404).json({ error: 'Usuário não encontrado.' });
    res.setHeader('Content-Disposition', `attachment; filename="finflow-backup-${todayISO()}.json"`);
    // Dados financeiros completos: nenhum cache (navegador, proxy ou service worker) guarda a resposta.
    res.setHeader('Cache-Control', 'no-store');
    res.json(backup);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao gerar o backup.');
  }
});

// As linhas do arquivo reaproveitam os schemas das rotas (FIN-008), com três ajustes: o `id`
// original (para refazer os vínculos entre contas e lançamentos), as datas de criação, e os campos
// que o sync da Pluggy grava sem passar por aquelas regras — o nome de uma conta ou transação pode
// vir vazio do banco, e a moeda de uma conta pode ser qualquer código ISO (`pluggyCurrency`).
// Recusar esses valores tornaria impossível restaurar um backup legítimo.
const backupIdField = z.string({ error: 'Identificador ausente.' }).regex(/^[A-Za-z0-9_-]{1,64}$/, 'Identificador inválido.');
const backupAccountRef = z.preprocess(v => (v === '' ? null : v), backupIdField.nullable().optional());
const backupDateField = z.iso.datetime({ message: 'Data inválida.' }).transform(value => new Date(value)).optional();
const backupCurrencyField = z.string().regex(CURRENCY_CODE_PATTERN, 'Moeda deve ser um código ISO de 3 letras.').optional();
const backupExternalKey = z.string().trim().min(1).max(200).nullable().optional();

const backupAccountSchema = accountSchema.extend({
  id: backupIdField,
  pluggyId: backupExternalKey,
  name: z.string().max(500),
  currency: backupCurrencyField,
  createdAt: backupDateField,
});
// Sem `currency`: como em toda gravação de transação, a moeda vem da conta (FIN-074).
const backupTransactionSchema = transactionSchema.omit({ externalId: true }).extend({
  id: backupIdField,
  accountId: backupAccountRef,
  pluggyId: backupExternalKey,
  importHash: backupExternalKey,
  name: z.string().max(500),
  createdAt: backupDateField,
});
const backupDebtSchema = debtSchema.extend({ id: backupIdField, accountId: backupAccountRef, createdAt: backupDateField });
const backupBudgetSchema = budgetSchema.extend({ id: backupIdField, createdAt: backupDateField });
const backupGoalSchema = goalSchema.extend({ id: backupIdField, createdAt: backupDateField });
const backupRecurringSchema = recurringSchema.extend({ id: backupIdField, accountId: backupAccountRef, createdAt: backupDateField });
const backupInvestmentSchema = investmentSchema.extend({
  id: backupIdField,
  accountId: backupAccountRef,
  currency: backupCurrencyField,
  createdAt: backupDateField,
  updatedAt: backupDateField,
});

const backupRows = schema => z.array(schema).max(MAX_BACKUP_ROWS, `mais de ${MAX_BACKUP_ROWS} registros.`);
const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT, { message: 'O arquivo não é um backup do FinFlow.' }),
  version: z.literal(BACKUP_VERSION, { message: 'Versão de backup não suportada.' }),
  data: z.object({
    accounts: backupRows(backupAccountSchema),
    transactions: backupRows(backupTransactionSchema),
    debts: backupRows(backupDebtSchema),
    budgets: backupRows(backupBudgetSchema),
    goals: backupRows(backupGoalSchema),
    recurring: backupRows(backupRecurringSchema),
    investments: backupRows(backupInvestmentSchema),
  }),
});

/** "transação nº 2" — posição de um registro no arquivo, para as mensagens de erro. */
function backupRowLabel(section, index) {
  return `${BACKUP_SECTIONS[section][0]} nº ${index + 1}`;
}

/** Mensagem legível dos três primeiros problemas de validação, com a posição de cada um no arquivo. */
function backupIssueMessage(issues) {
  const describe = issue => {
    const [root, section, index, field] = issue.path;
    const text = (issue.code === 'invalid_type' ? 'valor ausente ou com tipo errado' : issue.message).replace(/\.$/, '');
    if (root !== 'data') return text;
    if (section === undefined) return 'o arquivo não tem a seção de dados';
    if (!Object.prototype.hasOwnProperty.call(BACKUP_SECTIONS, section)) return text;
    if (typeof index !== 'number') return `seção de ${BACKUP_SECTIONS[section][1]}: ${text}`;
    return `${backupRowLabel(section, index)}${field !== undefined ? ` (${String(field)})` : ''}: ${text}`;
  };
  const shown = issues.slice(0, 3).map(describe).join('; ');
  const more = issues.length > 3 ? ` — e mais ${issues.length - 3} problema(s)` : '';
  return `Backup inválido: ${shown}${more}.`;
}

/**
 * Coerência interna do arquivo, conferida antes de apagar qualquer coisa: ids repetidos, vínculo
 * com conta que não está no arquivo, investimento em cartão de crédito (a mesma regra de
 * `investmentAccountError`) e as constraints únicas do banco — sem esta checagem, a violação só
 * apareceria no meio da gravação. Devolve a mensagem do primeiro problema, ou `null`.
 */
function backupConsistencyError(data) {
  for (const section of Object.keys(BACKUP_SECTIONS)) {
    const seen = new Set();
    for (const [index, row] of data[section].entries()) {
      if (seen.has(row.id)) return `${backupRowLabel(section, index)}: identificador repetido no arquivo.`;
      seen.add(row.id);
    }
  }
  const accountTypes = new Map(data.accounts.map(account => [account.id, account.type]));
  for (const section of ['transactions', 'debts', 'recurring', 'investments']) {
    for (const [index, row] of data[section].entries()) {
      if (row.accountId && !accountTypes.has(row.accountId)) {
        return `${backupRowLabel(section, index)}: aponta para uma conta que não está no arquivo.`;
      }
    }
  }
  for (const [index, investment] of data.investments.entries()) {
    if (investment.accountId && accountTypes.get(investment.accountId) === 'credit') {
      return `${backupRowLabel('investments', index)}: vinculado a um cartão de crédito.`;
    }
  }
  const uniqueKeys = [
    ['budgets', 'category', 'categoria repetida'],
    ['accounts', 'pluggyId', 'conta da Pluggy repetida'],
    ['transactions', 'pluggyId', 'transação da Pluggy repetida'],
    ['transactions', 'importHash', 'transação importada repetida'],
  ];
  for (const [section, key, problem] of uniqueKeys) {
    const seen = new Set();
    for (const [index, row] of data[section].entries()) {
      const value = row[key];
      if (value == null) continue;
      if (seen.has(value)) return `${backupRowLabel(section, index)}: ${problem}.`;
      seen.add(value);
    }
  }
  return null;
}

/**
 * Algum id do arquivo já pertence a outro usuário? Acontece quando o backup de uma pessoa é
 * restaurado na conta de outra, no mesmo servidor. Consulta em lotes de 500 ids, abaixo do
 * limite de parâmetros do SQLite.
 */
async function backupIdsTakenByOthers(userId, data) {
  const models = {
    accounts: prisma.account, transactions: prisma.transaction, debts: prisma.debt, budgets: prisma.budget,
    goals: prisma.goal, recurring: prisma.recurringTransaction, investments: prisma.investment,
  };
  for (const [section, model] of Object.entries(models)) {
    const ids = data[section].map(row => row.id);
    for (let i = 0; i < ids.length; i += 500) {
      const taken = await model.count({ where: { id: { in: ids.slice(i, i + 500) }, userId: { not: userId } } });
      if (taken > 0) return true;
    }
  }
  return false;
}

/**
 * Linhas a gravar para `userId`. Com `reuseIds`, os ids do arquivo são mantidos: a restauração
 * devolve os dados exatamente como eram — inclusive a chave de deduplicação das importações de
 * extrato, que inclui o id da conta. Sem, cada registro ganha um id novo e os vínculos com as
 * contas são refeitos pelo mapa. O `userId` é sempre o de quem restaura, nunca o do arquivo.
 */
function buildRestoreRows(userId, data, reuseIds) {
  const newId = id => (reuseIds ? id : crypto.randomUUID());
  const accountIds = new Map(data.accounts.map(account => [account.id, newId(account.id)]));
  const accountCurrency = new Map(data.accounts.map(account => [account.id, account.currency ?? BASE_CURRENCY]));
  const accountRef = accountId => (accountId ? accountIds.get(accountId) : null);

  const debtItems = [];
  return {
    accounts: data.accounts.map(({ id, ...account }) => ({
      ...account, id: accountIds.get(id), userId, currency: account.currency ?? BASE_CURRENCY,
    })),
    transactions: data.transactions.map(({ id, accountId, ...tx }) => ({
      paymentType: 'debit',
      ...tx,
      id: newId(id),
      userId,
      accountId: accountRef(accountId),
      currency: accountId ? accountCurrency.get(accountId) : BASE_CURRENCY,
    })),
    debts: data.debts.map(({ id, accountId, subItems, ...debt }) => {
      const debtId = newId(id);
      for (const item of subItems ?? []) debtItems.push({ ...item, debtId });
      return { paidAmount: 0, paidInstallments: 0, ...debt, id: debtId, userId, accountId: accountRef(accountId) };
    }),
    debtItems,
    budgets: data.budgets.map(({ id, ...budget }) => ({ ...budget, id: newId(id), userId })),
    goals: data.goals.map(({ id, ...goal }) => ({ currentAmount: 0, ...goal, id: newId(id), userId })),
    recurring: data.recurring.map(({ id, accountId, ...rec }) => ({
      active: true, ...rec, id: newId(id), userId, accountId: accountRef(accountId),
    })),
    investments: data.investments.map(({ id, accountId, ...investment }) => ({
      ...investment, id: newId(id), userId, accountId: accountRef(accountId), currency: investment.currency ?? BASE_CURRENCY,
    })),
  };
}

// Restauração: SUBSTITUI todos os dados do usuário pelos do arquivo, numa única transação de banco
// — ou tudo é trocado, ou nada muda. Por ser destrutiva, pede a senha, e o arquivo inteiro é
// validado antes de qualquer exclusão. O corpo só é lido depois da autenticação, com limite
// próprio (o parser global pula esta rota — ver `isBackupImportPath`).
app.post(BACKUP_IMPORT_PATH, authLimiter, authenticateToken, express.json({ limit: BACKUP_BODY_LIMIT }), async (req, res) => {
  const userId = req.user.userId;
  const { password, backup } = req.body ?? {};
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Confirme a restauração com a sua senha.' });
  }
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
    return res.status(400).json({ error: 'Envie o conteúdo do arquivo de backup.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (!(await bcrypt.compare(password, user.passwordHash))) return res.status(400).json({ error: 'Senha incorreta.' });

    const parsed = backupSchema.safeParse(backup);
    if (!parsed.success) return res.status(400).json({ error: backupIssueMessage(parsed.error.issues) });
    const data = parsed.data.data;
    const inconsistency = backupConsistencyError(data);
    if (inconsistency) return res.status(400).json({ error: `Backup inválido: ${inconsistency}` });

    const rows = buildRestoreRows(userId, data, !(await backupIdsTakenByOthers(userId, data)));
    await prisma.$transaction([
      // Filhos antes dos pais, por causa das chaves estrangeiras.
      prisma.debtItem.deleteMany({ where: { debt: { userId } } }),
      prisma.debt.deleteMany({ where: { userId } }),
      prisma.transaction.deleteMany({ where: { userId } }),
      prisma.recurringTransaction.deleteMany({ where: { userId } }),
      prisma.investment.deleteMany({ where: { userId } }),
      prisma.budget.deleteMany({ where: { userId } }),
      prisma.goal.deleteMany({ where: { userId } }),
      // Avisos derivados dos dados antigos; os dos restaurados são gerados na próxima carga do app.
      prisma.notification.deleteMany({ where: { userId } }),
      prisma.account.deleteMany({ where: { userId } }),
      prisma.account.createMany({ data: rows.accounts }),
      prisma.transaction.createMany({ data: rows.transactions }),
      prisma.debt.createMany({ data: rows.debts }),
      prisma.debtItem.createMany({ data: rows.debtItems }),
      prisma.budget.createMany({ data: rows.budgets }),
      prisma.goal.createMany({ data: rows.goals }),
      prisma.recurringTransaction.createMany({ data: rows.recurring }),
      prisma.investment.createMany({ data: rows.investments }),
    ]);

    const restored = Object.fromEntries(Object.keys(BACKUP_SECTIONS).map(section => [section, data[section].length]));
    res.json({ success: true, restored });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao restaurar o backup. Nenhum dado foi alterado.');
  }
});

/* -------------------------------------------------------------------------- */
/*                           PLUGGY OPEN FINANCE                               */
/* -------------------------------------------------------------------------- */

// POST /api/pluggy/connect-token — Gera o token temporário para o widget
app.post('/api/pluggy/connect-token', authenticateToken, async (req, res) => {
  try {
    const response = await getPluggyClient().createConnectToken(undefined, {
      clientUserId: req.user.userId,
    });
    res.json({ accessToken: response.accessToken });
  } catch (error) {
    sendInternalError(res, error, 'Erro ao conectar à API da Pluggy.');
  }
});

// POST /api/pluggy/connect-item — Recebe itemId do widget e registra no banco
app.post('/api/pluggy/connect-item', authenticateToken, async (req, res) => {
  const { itemId } = req.body;
  if (!itemId) return res.status(400).json({ error: 'itemId é obrigatório.' });

  try {
    const pluggyItem = await getPluggyClient().fetchItem(itemId);
    const userId = req.user.userId;

    // Upsert usando a constraint (userId, pluggyId) — atômico a nível de banco, evita
    // duplicar a conta se duas requisições chegarem em paralelo (ver FIN-021).
    await prisma.account.upsert({
      where: { userId_pluggyId: { userId, pluggyId: itemId } },
      update: {}, // já existe — nada a atualizar aqui, o sync cuida dos dados reais da conta
      create: {
        userId,
        pluggyId: itemId,
        name: pluggyItem.connector.name,
        bank: pluggyItem.connector.name,
        type: 'checking',
        balance: 0,
        color: '#6366f1',
      },
    });

    // Reporta o status do item já na conexão inicial (ver FIN-041) — um item pode nascer
    // em LOGIN_ERROR (ex. credenciais rejeitadas pelo banco na primeira tentativa).
    res.json({
      success: true,
      providerName: pluggyItem.connector.name,
      pluggyStatus: pluggyItem.status,
      statusMessage: pluggyReauthMessage(pluggyItem.status),
    });
  } catch (error) {
    sendInternalError(res, error, 'Erro ao registrar conexão bancária.');
  }
});

// POST /api/pluggy/sync/:itemId — Sincroniza contas e transações do banco conectado
app.post('/api/pluggy/sync/:itemId', authenticateToken, async (req, res) => {
  const { itemId } = req.params;
  const userId = req.user.userId;

  try {
    // Verifica o status do item antes de tentar sincronizar (ver FIN-041 em
    // docs/BACKLOG_DETAIL.md) — sem isso, uma conexão que exige reautenticação
    // (LOGIN_ERROR/OUTDATED) falhava na sincronização com um erro genérico, sem indicar
    // ao usuário que a ação necessária é reconectar o banco.
    const pluggyItem = await getPluggyClient().fetchItem(itemId);
    const reauthMessage = pluggyReauthMessage(pluggyItem.status);
    if (reauthMessage) {
      return res.status(409).json({ error: reauthMessage, pluggyStatus: pluggyItem.status });
    }

    const accountsRes = await getPluggyClient().fetchAccounts(itemId);
    if (!accountsRes.results || accountsRes.results.length === 0) {
      return res.status(404).json({ error: 'Nenhuma conta encontrada para este item.' });
    }

    let totalTxs = 0;

    for (const pluggyAcc of accountsRes.results) {
      const accountType = mapPluggyAccountType(pluggyAcc);
      const accountCurrency = pluggyCurrency(pluggyAcc.currencyCode); // FIN-074
      // Upsert atômico via constraint (userId, pluggyId) — ver FIN-021.
      const localAccount = await prisma.account.upsert({
        where: { userId_pluggyId: { userId, pluggyId: pluggyAcc.id } },
        create: {
          userId,
          pluggyId: pluggyAcc.id,
          name: pluggyAcc.name,
          bank: pluggyAcc.marketingName || 'Banco Conectado',
          type: accountType,
          balance: toCents(pluggyAcc.balance),
          currency: accountCurrency,
          color: '#6366f1',
        },
        update: { balance: toCents(pluggyAcc.balance), name: pluggyAcc.name, currency: accountCurrency },
      });
      // FIN-074: as transações da conta ficam na moeda dela. Só grava se alguma estiver em
      // outra moeda — na prática, nunca depois da primeira sincronização.
      await prisma.transaction.updateMany({
        where: { userId, accountId: localAccount.id, currency: { not: accountCurrency } },
        data: { currency: accountCurrency },
      });

      // Para cartões de crédito, busca a fatura real via endpoint dedicado da Pluggy
      // e atualiza `pendingBill` — não é possível inferir a fatura a partir de `balance`
      // para contas do tipo CREDIT (ver FIN-001 em docs/BACKLOG_DETAIL.md).
      if (pluggyAcc.type === 'CREDIT') {
        try {
          const billsRes = await getPluggyClient().fetchCreditCardBills(pluggyAcc.id);
          const bills = billsRes?.results ?? [];
          if (bills.length > 0) {
            // A fatura pendente é a mais recentemente fechada (maior billClosingDate/dueDate) —
            // não a de menor data, que representaria uma fatura antiga já superada.
            const currentBill = [...bills].sort((a, b) => {
              const dateA = new Date(a.billClosingDate ?? a.dueDate).getTime();
              const dateB = new Date(b.billClosingDate ?? b.dueDate).getTime();
              return dateB - dateA;
            })[0];
            // FIN-067: o dia de vencimento vem da própria fatura. Sem ele, o aviso de fatura a
            // vencer nunca dispararia para um cartão conectado via Pluggy — o cadastro manual de
            // `dueDay` era o único caminho, e a sincronização não o preenchia.
            const dueDay = pluggyBillDueDay(currentBill);
            await prisma.account.updateMany({
              where: { id: localAccount.id, userId },
              data: { pendingBill: toCents(currentBill.totalAmount), ...(dueDay ? { dueDay } : {}) },
            });
          }
        } catch (billError) {
          console.error(`Erro ao buscar fatura do cartão (accountId=${pluggyAcc.id}):`, billError);
        }
      }

      // Busca transações do último mês, paginando até obter todas — a API da Pluggy pagina
      // por padrão (20 itens/página, máx. 500), então sem este loop uma conta com mais
      // transações que uma página perderia dados silenciosamente (ver FIN-038 em
      // docs/BACKLOG_DETAIL.md).
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      const fromDate = oneMonthAgo.toISOString().split('T')[0];

      const allPluggyTxs = [];
      let page = 1;
      let totalPages = 1;
      do {
        const txsRes = await getPluggyClient().fetchTransactions(pluggyAcc.id, { from: fromDate, page, pageSize: 500 });
        allPluggyTxs.push(...txsRes.results);
        totalPages = txsRes.totalPages;
        page++;
      } while (page <= totalPages);

      // FIN-092: em conta de cartão, descarta o pagamento da própria fatura — ver
      // `isCreditCardBillPayment`. O filtro é feito aqui, antes de qualquer uso, para que
      // a query de existentes, o refresh e a inserção enxerguem todos o mesmo conjunto.
      const pluggyTxs = accountType === 'credit'
        ? allPluggyTxs.filter(tx => !isCreditCardBillPayment(tx))
        : allPluggyTxs;

      // FIN-037: busca de uma vez os `pluggyId` já existentes desta sincronização (1
      // consulta), em vez de um `findFirst` por transação (N consultas).
      const existingTxs = await prisma.transaction.findMany({
        where: { userId, pluggyId: { in: pluggyTxs.map(t => t.id) } },
        select: { pluggyId: true, name: true, date: true, amount: true, paymentType: true },
      });
      const existingByPluggyId = new Map(existingTxs.map(t => [t.pluggyId, t]));

      const newPluggyTxs = pluggyTxs.filter(tx => !existingByPluggyId.has(tx.id));
      totalTxs += newPluggyTxs.length;

      // Transações já existentes: a Pluggy pode reportar valor/descrição/data diferentes
      // numa sincronização posterior (ex.: transação que estava pendente e "assentou" com
      // valor final diferente do provisório) — sem isto o app ficaria com dados
      // desatualizados indefinidamente após a primeira sincronização. Só grava (1 UPDATE)
      // quando algo realmente mudou, então o custo extra é próximo de zero na maioria das
      // sincronizações (poucas transações do último mês mudam de um sync para o outro).
      for (const tx of pluggyTxs) {
        const existing = existingByPluggyId.get(tx.id);
        if (!existing) continue;
        const freshDate = tx.date.toISOString().split('T')[0];
        const freshAmount = pluggyAmountToCents(tx, accountType);
        const freshPaymentType = accountType === 'credit' ? 'credit' : 'debit';
        if (
          existing.name !== tx.description || existing.date !== freshDate ||
          existing.amount !== freshAmount || existing.paymentType !== freshPaymentType
        ) {
          await prisma.transaction.updateMany({
            where: { userId, pluggyId: tx.id },
            data: { name: tx.description, date: freshDate, amount: freshAmount, paymentType: freshPaymentType },
          });
        }
      }

      if (newPluggyTxs.length > 0) {
        const data = newPluggyTxs.map(tx => ({
          userId,
          accountId: localAccount.id,
          pluggyId: tx.id,
          name: tx.description,
          category: tx.category || 'Outros',
          date: tx.date.toISOString().split('T')[0],
          amount: pluggyAmountToCents(tx, accountType),
          currency: accountCurrency, // FIN-074
          // Deixa explícito na transação que ela veio de um cartão — é o que o app já
          // exibe na lista, e serve de marca de que o sinal foi normalizado (FIN-092).
          paymentType: accountType === 'credit' ? 'credit' : 'debit',
        }));
        try {
          await prisma.transaction.createMany({ data });
        } catch (err) {
          // Corrida rara: outra sincronização inseriu a mesma transação entre o
          // `findMany` acima e este `createMany` (que, ao contrário de `create`
          // individual, falha inteiro — não por linha — ao violar a constraint única, e
          // o SQLite não suporta `skipDuplicates` no Prisma). Cai para upsert linha a
          // linha só neste caso raro, protegido pela constraint (ver FIN-021) — e também
          // atualiza os dados no conflito, para ficar consistente com o loop de refresh acima.
          if (err.code === 'P2002') {
            for (const t of data) {
              await prisma.transaction.upsert({
                where: { userId_pluggyId: { userId, pluggyId: t.pluggyId } },
                create: t,
                update: { name: t.name, category: t.category, date: t.date, amount: t.amount, paymentType: t.paymentType, currency: t.currency },
              });
            }
          } else {
            throw err;
          }
        }
      }

      // Nota: reconciliação de transações removidas/substituídas do lado da Pluggy (ex.:
      // uma transação pendente que desaparece e é substituída por outra com ID diferente)
      // fica fora do escopo desta correção — exigiria comparar todo o histórico já
      // importado contra a janela de datas retornada pela Pluggy para decidir com segurança
      // o que apagar, e um erro nessa lógica apagaria transações reais do usuário. Preferível
      // tratar como item de backlog dedicado a ser desenhado com mais cuidado.
    }

    res.json({ success: true, message: `Sincronizacao concluida! ${totalTxs} novas transacoes importadas.` });
  } catch (error) {
    sendInternalError(res, error, 'Erro na sincronização de dados.');
  }
});

// Erros que escapam das rotas — em especial os do parser de JSON (corpo malformado ou grande
// demais) — respondem em JSON, como o resto da API. Sem este tratador, iam para o padrão do
// Express, que responde uma página HTML, com a pilha do erro fora de produção (ver FIN-011).
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      error: isBackupImportPath(req)
        ? 'O arquivo de backup passa do tamanho máximo aceito (25 MB).'
        : 'Os dados enviados passam do tamanho máximo aceito.',
    });
  }
  const status = Number(err?.status ?? err?.statusCode);
  if (status >= 400 && status < 500) {
    return res.status(status).json({
      error: err?.type === 'entity.parse.failed' ? 'O corpo da requisição não é um JSON válido.' : 'Requisição inválida.',
    });
  }
  sendInternalError(res, err);
});

// Só sobe o servidor de verdade quando este arquivo é executado diretamente (`node
// server.js`/`nodemon server.js`) — não quando é importado por um teste (ver FIN-031 em
// docs/BACKLOG_DETAIL.md). `app` é exportado para que os testes de integração (Supertest)
// façam requisições contra ele em memória, sem abrir uma porta TCP real nem depender de um
// servidor já rodando.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    console.log(`Finance Dashboard API Proxy running on http://localhost:${PORT}`);
  });
}

// `prisma` também exportado para que os testes possam chamar `$disconnect()` no
// `afterAll` — sem isso, better-sqlite3 mantém o arquivo aberto e a limpeza do banco de
// teste (`unlink`) falha com `EBUSY` no Windows (ver FIN-031).
export {
  app, prisma, pluggyReauthMessage, pluggyAmountToCents, isCreditCardBillPayment,
  nextBillDueDate, pluggyBillDueDay, buildDueNotifications, detectUnusualSpending,
  pluggyCurrency, formatCents, SUPPORTED_CURRENCIES, parseProviderRates, createExchangeRateCache,
  encryptTwoFactorSecret, decryptTwoFactorSecret,
};
