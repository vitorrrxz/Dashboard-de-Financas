import { advanceMonth } from './dates';
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

/**
 * Uma dívida é considerada quitada quando o valor pago já atinge o total OU quando o
 * número de parcelas pagas atinge o total de parcelas — checa as duas condições porque
 * arredondamentos em `monthlyPayment` acumulado podem fazer `paidAmount` alcançar
 * `totalAmount` antes da última parcela nominal ser contada (ver `computeNextInstallment`,
 * que já capa `paidAmount` em `totalAmount` mas não força `paidInstallments` a acompanhar).
 */
export function isDebtPaid(debt: Pick<Debt, 'paidInstallments' | 'totalInstallments' | 'paidAmount' | 'totalAmount'>): boolean {
  return debt.paidAmount >= debt.totalAmount || debt.paidInstallments >= debt.totalInstallments;
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
export function isDebtOverdue(debt: Pick<Debt, 'nextDueDate' | 'paidInstallments' | 'totalInstallments' | 'paidAmount' | 'totalAmount'>): boolean {
  return !isDebtPaid(debt) && debt.nextDueDate < todayISO();
}

/**
 * Calcula os novos `paidInstallments`/`paidAmount`/`nextDueDate` ao pagar uma parcela de
 * uma dívida. Extraído de `DebtManager.tsx` (ver FIN-086/FIN-034 em
 * docs/BACKLOG_DETAIL.md) — antes duplicado quase identicamente entre `handlePayInstallment`
 * (pagar uma dívida) e `handlePayAll` (pagar todas). `paidAmount` nunca ultrapassa
 * `totalAmount`, mesmo com arredondamento de `monthlyPayment` acumulado ao longo das
 * parcelas — a última parcela sempre fecha exatamente em `totalAmount`.
 */
export function computeNextInstallment(
  debt: Pick<Debt, 'paidInstallments' | 'paidAmount' | 'monthlyPayment' | 'totalInstallments' | 'totalAmount' | 'nextDueDate'>
): { paidInstallments: number; paidAmount: number; nextDueDate: string } {
  const nextPaidInstallments = debt.paidInstallments + 1;
  let nextPaidAmount = debt.paidAmount + debt.monthlyPayment;
  if (nextPaidInstallments >= debt.totalInstallments) {
    nextPaidAmount = debt.totalAmount;
  } else {
    nextPaidAmount = Math.min(nextPaidAmount, debt.totalAmount);
  }
  return {
    paidInstallments: nextPaidInstallments,
    paidAmount: nextPaidAmount,
    nextDueDate: advanceMonth(debt.nextDueDate),
  };
}
