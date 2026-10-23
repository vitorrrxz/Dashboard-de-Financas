// Recorrências no planejamento do mês (sobra, régua, projeção): as de despesa (Despesas Recorrentes)
// saem, as de receita (Devedores) entram. Valores em reais.
import { advanceOccurrence, daysBetween, shiftMonth } from './dates';
import { remainingDebtSchedule } from './debts';
import { OWN_TRANSFER_CATEGORIES } from './categories';
import { groupInstallmentPurchases, isInstallmentTransaction } from './installments';
import type { Account, Debt, RecurringTransaction, Transaction } from '../types';

/** Uma ocorrência de recorrência: a data em que cai e o valor (positivo, entrada ou saída). */
export interface RecurringOutflow {
  date: string;
  amount: number;
  accountId?: string;
}

// Teto de ocorrências por recorrência: uma semanal num ano dá 53, e a projeção olha poucos meses.
const MAX_OCCURRENCES = 120;

/** Recorrências que entram no planejamento: as ativas que são despesa. */
export function recurringExpenses(recurring: RecurringTransaction[]): RecurringTransaction[] {
  return recurring.filter(r => r.active && r.amount < 0);
}

/** Recorrências de receita ativas (Devedores): entram na sobra e na projeção. O devedor que já pagou tudo, não. */
export function recurringIncomes(recurring: RecurringTransaction[]): RecurringTransaction[] {
  return recurring.filter(r => r.active && r.amount > 0 && r.remainingPayments !== 0);
}

/**
 * Ocorrências ainda não lançadas das recorrências de despesa ativas, de `nextOccurrence` (o ponteiro
 * do que já virou transação) até o fim de `untilMonth` (YYYY-MM), em ordem de data por recorrência.
 */
export function upcomingRecurringOutflows(recurring: RecurringTransaction[], untilMonth: string): RecurringOutflow[] {
  return upcomingOccurrences(recurringExpenses(recurring), untilMonth);
}

/**
 * O mesmo de `upcomingRecurringOutflows`, para as recorrências de receita. O devedor vinculado a uma
 * dívida (`debtId`) só paga até a última parcela dela — quitada, ele não entra mais.
 */
export function upcomingRecurringInflows(recurring: RecurringTransaction[], untilMonth: string, debts: Debt[] = []): RecurringOutflow[] {
  const lastInstallmentMonth = new Map(debts.map(d => [d.id, remainingDebtSchedule(d).at(-1)?.dueDate.slice(0, 7) ?? '']));
  return recurringIncomes(recurring).flatMap(r => {
    const debtEnd = r.debtId ? lastInstallmentMonth.get(r.debtId) : undefined;
    return upcomingOccurrences([r], debtEnd !== undefined && debtEnd < untilMonth ? debtEnd : untilMonth);
  });
}

function upcomingOccurrences(recurring: RecurringTransaction[], untilMonth: string): RecurringOutflow[] {
  const out: RecurringOutflow[] = [];
  for (const r of recurring) {
    let occurrence = r.nextOccurrence;
    // Devedor de uma cobrança: só os pagamentos que faltam.
    const limit = Math.min(MAX_OCCURRENCES, r.remainingPayments ?? MAX_OCCURRENCES);
    for (let i = 0; i < limit && occurrence.slice(0, 7) <= untilMonth; i++) {
      out.push({ date: occurrence, amount: Math.abs(r.amount), accountId: r.accountId });
      const next = advanceOccurrence(occurrence, r.frequency);
      // Mesma proteção do lançamento no servidor: sem avanço, o laço não terminaria.
      if (next <= occurrence) break;
      occurrence = next;
    }
  }
  return out;
}

/** Uma cobrança do cartão que um devedor pode pagar: compra à vista ou parcelada. */
export interface DebtorCharge {
  key: string;
  /** Nome da compra, com as parcelas (`Loja · 10x`) quando parcelada. */
  name: string;
  date: string;
  /** Valor de cada pagamento (a parcela, ou a compra inteira à vista), positivo. */
  amount: number;
  /** Pagamentos sugeridos: a parcela deste mês e as que faltam; 1 à vista. */
  payments: number;
  /** Data da primeira parcela desses pagamentos (a da compra, à vista): a fatura dela é o primeiro vencimento. */
  firstDate: string;
  /** Cartão da compra. */
  accountId?: string;
}

// Compras do cartão de até 3 meses atrás: a cobrança de quem usou o cartão é recente.
const CHARGE_MONTHS_BACK = 3;

/** Chave de uma compra entre as parcelas: cartão, começo do nome (só letras e números) e valor em centavos. */
function chargeKey(accountId: string | undefined, name: string, amount: number): string {
  const start = name.normalize('NFD').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
  return [accountId ?? '', start, Math.round(Math.abs(amount) * 100)].join('|');
}

/**
 * Cobranças do cartão que dá para vincular a um devedor (alguém usou o seu cartão), cada compra uma
 * vez só, mais recentes primeiro:
 * - parcelada com "n/N" no nome: a compra reagrupada (`groupInstallmentPurchases`), em andamento ou recente;
 * - parcelada sem "n/N": o banco às vezes manda as parcelas futuras só com o nome, e a primeira com outro
 *   nome ("MERCADOLIVRE*MERCADOLIVRE" e depois "MERCADOLIVRE*MERC"). Mesmo cartão, começo do nome e valor
 *   são a mesma compra: junto de uma parcelada com "n/N", some; com alguma data futura, entra uma vez só;
 * - à vista: as dos últimos meses, até hoje.
 */
export function debtorCharges(transactions: Transaction[], accounts: Account[], today: string): DebtorCharge[] {
  const since = `${shiftMonth(today.slice(0, 7), -CHARGE_MONTHS_BACK)}-01`;
  const thisMonth = `${today.slice(0, 7)}-01`;
  const cards = new Set(accounts.filter(a => a.type === 'credit').map(a => a.id));

  const purchases = groupInstallmentPurchases(transactions, today);
  const inPurchase = new Set(purchases.flatMap(p => p.installments.map(i => chargeKey(p.accountId, p.name, i.amount))));
  const installments: DebtorCharge[] = purchases
    .filter(p => p.installments[p.installments.length - 1].date >= since)
    .map(p => ({
      key: `card:${p.key}`,
      name: `${p.name} · ${p.totalInstallments}x`,
      date: p.installments[0].date,
      amount: p.installmentAmount,
      payments: Math.max(1, p.installments.filter(i => i.date >= thisMonth).length),
      firstDate: (p.installments.find(i => i.date >= thisMonth) ?? p.installments[p.installments.length - 1]).date,
      accountId: p.accountId,
    }));

  const series = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.amount >= 0 || t.date < since || isInstallmentTransaction(t) || OWN_TRANSFER_CATEGORIES.includes(t.category)) continue;
    if (t.paymentType !== 'credit' && !(t.accountId && cards.has(t.accountId))) continue;
    const key = chargeKey(t.accountId, t.name, t.amount);
    if (!inPurchase.has(key)) series.set(key, [...(series.get(key) ?? []), t]);
  }
  const others: DebtorCharge[] = [...series].flatMap(([key, rows]) => {
    rows.sort((a, b) => a.date.localeCompare(b.date));
    if (rows.some(t => t.date > today)) {
      return [{
        key: `series:${key}`,
        name: rows.length > 1 ? `${rows[0].name} · ${rows.length}x` : rows[0].name,
        date: rows[0].date,
        amount: Math.abs(rows[0].amount),
        payments: Math.max(1, rows.filter(t => t.date >= thisMonth).length),
        firstDate: (rows.find(t => t.date >= thisMonth) ?? rows[rows.length - 1]).date,
        accountId: rows[0].accountId,
      }];
    }
    return rows.map(t => ({ key: `tx:${t.id}`, name: t.name, date: t.date, amount: Math.abs(t.amount), payments: 1, firstDate: t.date, accountId: t.accountId }));
  });

  return [...installments, ...others].sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
}

// Dias antes ou depois do vencimento em que um PIX do mesmo valor pode ser o pagamento do devedor —
// mesma janela do servidor (`PAYMENT_WINDOW_DAYS` em routes/recurring.js).
const PAYMENT_WINDOW_DAYS: Record<RecurringTransaction['frequency'], number> = { weekly: 3, monthly: 10, yearly: 10 };

/**
 * PIX recebido que parece ser o pagamento do devedor, para o "Confirmar pagamento": mesmo valor, numa
 * conta que não é cartão, sem ter confirmado outro pagamento, perto do vencimento — o próximo, ou o da
 * receita prevista já lançada. Os lançamentos das recorrências (mesmo nome de uma delas) não contam.
 */
export function pendingPixPayment(
  rec: RecurringTransaction, transactions: Transaction[], accounts: Account[], recurring: RecurringTransaction[],
): Transaction | undefined {
  if (!rec.active || rec.amount <= 0) return undefined;
  const cents = (value: number) => Math.round(value * 100);
  const cards = new Set(accounts.filter(a => a.type === 'credit').map(a => a.id));
  const recurringNames = new Set(recurring.map(r => r.name));
  const lastPosted = transactions
    .filter(t => !t.recurringId && t.name === rec.name && cents(t.amount) === cents(rec.amount) && t.date < rec.nextOccurrence)
    .reduce<string | undefined>((latest, t) => (!latest || t.date > latest ? t.date : latest), undefined);
  const dueDates = lastPosted ? [rec.nextOccurrence, lastPosted] : [rec.nextOccurrence];
  const window = PAYMENT_WINDOW_DAYS[rec.frequency] ?? PAYMENT_WINDOW_DAYS.monthly;
  const distance = (t: Transaction) => Math.min(...dueDates.map(d => Math.abs(daysBetween(t.date, d))));
  return transactions
    .filter(t => t.amount > 0 && !t.recurringId && cents(t.amount) === cents(rec.amount) && !recurringNames.has(t.name)
      && !OWN_TRANSFER_CATEGORIES.includes(t.category) && !(t.accountId && cards.has(t.accountId)) && distance(t) <= window)
    .sort((a, b) => distance(a) - distance(b))[0];
}
