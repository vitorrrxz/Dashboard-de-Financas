// Salário manual e a sobra de cada pagamento. Valores em reais.
import type { Salary } from '../types';

/** Uma dívida do mês e o dia em que vence (vencimento da fatura ou da parcela). */
export interface Outflow {
  day: number;
  amount: number;
}

/** Total recebido no mês: quinzenal são dois pagamentos. Sem o bônus (ver `activeBonus`). */
export function salaryPerMonth(salary: Salary): number {
  return salary.amount + (salary.frequency === 'biweekly' ? salary.secondAmount : 0);
}

/** Bônus do mês (YYYY-MM): vale só no mês em que foi lançado. */
export function activeBonus(salary: Salary, month: string): number {
  return salary.bonusMonth === month ? salary.bonus : 0;
}

/** Dias dos dois pagamentos do quinzenal: o 2º é 15 dias depois, limitado ao fim do mês (30 → 28/fev). */
export function payDays(salary: Salary, monthDays: number): [number, number] {
  return [salary.payDay, Math.min(salary.payDay + 15, monthDays)];
}

/**
 * Sobra de cada quinzena: o pagamento dela (mais o bônus, na quinzena escolhida) menos as dívidas que
 * vencem até o pagamento seguinte. Do 1º ao dia anterior ao 2º pagamento é a 1ª quinzena; o resto do
 * mês (inclusive antes do 1º) é a 2ª. As duas somadas dão a sobra do mês. `inflows` (Devedores)
 * entram na quinzena do dia em que caem, somados ao `pay` dela.
 */
export function biweeklyLeftovers(salary: Salary, outflows: Outflow[], monthDays: number, bonus = 0, inflows: Outflow[] = []) {
  const [first, second] = payDays(salary, monthDays);
  const inFirst = (day: number) => day >= first && day < second;
  let firstPay = salary.amount + (salary.bonusHalf === 1 ? bonus : 0);
  let secondPay = salary.secondAmount + (salary.bonusHalf === 2 ? bonus : 0);
  for (const i of inflows) {
    if (inFirst(i.day)) firstPay += i.amount;
    else secondPay += i.amount;
  }
  let firstLeft = firstPay;
  let secondLeft = secondPay;
  for (const o of outflows) {
    if (inFirst(o.day)) firstLeft -= o.amount;
    else secondLeft -= o.amount;
  }
  return [{ day: first, pay: firstPay, leftover: firstLeft }, { day: second, pay: secondPay, leftover: secondLeft }];
}
