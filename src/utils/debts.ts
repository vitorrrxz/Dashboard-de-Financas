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

/** Uma parcela prevista de uma dívida cadastrada (ver `remainingDebtSchedule`). */
export interface ScheduledInstallment {
  /** Número da parcela (1 = primeira), contando também as que já foram pagas. */
  number: number;
  /** Vencimento (ISO YYYY-MM-DD). */
  dueDate: string;
  /** Valor da parcela, em reais, arredondado ao centavo. */
  amount: number;
}

// Teto de parcelas geradas por dívida. Um financiamento de 30 anos tem 360; o teto é só a
// rede de segurança contra dado inconsistente (ex.: `totalInstallments` absurdo).
const MAX_SCHEDULED_INSTALLMENTS = 600;

/**
 * Parcelas que ainda faltam pagar de uma dívida, em ordem de vencimento, a partir de
 * `nextDueDate` e em intervalos mensais.
 *
 * As parcelas intermediárias são limitadas ao saldo devedor, para nenhuma cobrar além do
 * que ainda se deve; a última fecha exatamente o saldo — mesma regra de
 * `computeNextInstallment`, que registra o último pagamento levando `paidAmount` a
 * `totalAmount`. Extraído de `computeBalanceProjection` (FIN-058) para que a visão mensal da
 * aba Dívidas (FIN-094) use o mesmo cronograma, em vez de uma segunda cópia do laço.
 */
export function remainingDebtSchedule(
  debt: Pick<Debt, 'totalAmount' | 'paidAmount' | 'monthlyPayment' | 'totalInstallments' | 'paidInstallments' | 'nextDueDate'>
): ScheduledInstallment[] {
  if (isDebtPaid(debt)) return [];
  const remainingInstallments = Math.max(0, debt.totalInstallments - debt.paidInstallments);
  const count = Math.min(remainingInstallments, MAX_SCHEDULED_INSTALLMENTS);
  const schedule: ScheduledInstallment[] = [];
  let remainingBalance = Math.max(0, debt.totalAmount - debt.paidAmount);
  let dueDate = debt.nextDueDate;

  for (let i = 0; i < count && remainingBalance > 0; i++) {
    const isLast = i === remainingInstallments - 1;
    const raw = isLast ? remainingBalance : Math.min(debt.monthlyPayment, remainingBalance);
    // Arredonda ao centavo: subtrair floats repetidamente acumula ruído (ver FIN-015).
    const amount = Math.round(raw * 100) / 100;
    if (amount <= 0) break; // parcela zerada (ex.: `monthlyPayment` 0): nada a prever
    schedule.push({ number: debt.paidInstallments + i + 1, dueDate, amount });
    remainingBalance -= amount;
    dueDate = advanceMonth(dueDate);
  }
  return schedule;
}
