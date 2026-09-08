import type { Debt } from '../types';

/**
 * Data de hoje no fuso horário local do usuário, como string ISO (YYYY-MM-DD).
 * Usa `getFullYear`/`getMonth`/`getDate` (local) em vez de `toISOString()` (UTC) —
 * evita o deslocamento de até um dia que ocorreria perto da meia-noite em fusos
 * negativos como o do Brasil (UTC-3).
 */
export function todayISO(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isDebtPaid(debt: Pick<Debt, 'paidInstallments' | 'totalInstallments'>): boolean {
  return debt.paidInstallments >= debt.totalInstallments;
}

/**
 * Uma dívida está vencida se ainda não foi quitada e sua próxima data de vencimento
 * já passou. A comparação é feita inteiramente com strings ISO (YYYY-MM-DD) — nunca
 * com `new Date(nextDueDate)` — porque `new Date('YYYY-MM-DD')` é interpretado como
 * UTC 00:00 e, comparado a `new Date()` (hora local), pode divergir da data real do
 * usuário dependendo do fuso horário e do horário do dia.
 *
 * Fonte única de verdade para "dívida vencida" — usada tanto no Dashboard quanto no
 * gerenciador de dívidas, que antes tinham implementações divergentes (ver FIN-005
 * em docs/BACKLOG_DETAIL.md).
 */
export function isDebtOverdue(debt: Pick<Debt, 'nextDueDate' | 'paidInstallments' | 'totalInstallments'>): boolean {
  return !isDebtPaid(debt) && debt.nextDueDate < todayISO();
}
