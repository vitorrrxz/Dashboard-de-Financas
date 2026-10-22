// Recorrências de despesa no planejamento do mês (sobra, régua, projeção). Valores em reais.
import { advanceOccurrence } from './dates';
import type { RecurringTransaction } from '../types';

/** Uma ocorrência de recorrência: a data em que cai e o valor que sai (positivo). */
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

/**
 * Ocorrências ainda não lançadas das recorrências de despesa ativas, de `nextOccurrence` (o ponteiro
 * do que já virou transação) até o fim de `untilMonth` (YYYY-MM), em ordem de data por recorrência.
 */
export function upcomingRecurringOutflows(recurring: RecurringTransaction[], untilMonth: string): RecurringOutflow[] {
  const out: RecurringOutflow[] = [];
  for (const r of recurringExpenses(recurring)) {
    let occurrence = r.nextOccurrence;
    for (let i = 0; i < MAX_OCCURRENCES && occurrence.slice(0, 7) <= untilMonth; i++) {
      out.push({ date: occurrence, amount: Math.abs(r.amount), accountId: r.accountId });
      const next = advanceOccurrence(occurrence, r.frequency);
      // Mesma proteção do lançamento no servidor: sem avanço, o laço não terminaria.
      if (next <= occurrence) break;
      occurrence = next;
    }
  }
  return out;
}
