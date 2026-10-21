import './env.js';
import { addDaysISO, daysInMonth, formatISODate, monthLabelPtBR, shiftMonthKey } from './dates.js';
import { formatCents, formatCentsBRL, formatDayMonth } from './money.js';
import { OWN_TRANSFER_CATEGORIES } from './pluggyHelpers.js';

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
export const NOTIFICATION_SETTINGS = {
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
export function nextBillDueDate(dueDay, today) {
  const [year, month] = today.split('-').map(Number);
  const thisMonth = formatISODate(year, month, Math.min(dueDay, daysInMonth(year, month)));
  if (thisMonth >= today) return thisMonth;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return formatISODate(nextYear, nextMonth, Math.min(dueDay, daysInMonth(nextYear, nextMonth)));
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
export function buildDueNotifications(debts, accounts, today, dueSoonDays) {
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
export function detectUnusualSpending(transactions, today, { months, threshold, minCents, historyStart } = {}) {
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
    if (t.amount >= 0 || OWN_TRANSFER_CATEGORIES.includes(t.category)) continue;
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
