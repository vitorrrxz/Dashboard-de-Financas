import type { Debt, Salary } from '../types';
import { advanceMonth } from './dates';
import { remainingDebtSchedule, todayISO } from './debts';
import { activeBonus, salaryPerMonth } from './salary';

// FIN-058 — projeção de saldo futuro: saldo atual + salário − dívidas do mês, mês a mês. Função
// pura, calculada no frontend a partir dos dados já carregados e testável sem renderizar
// componentes. É a "sobra" do card de salário (salário − dívidas) acumulada mês a mês.
//
// Todos os valores estão em REAIS, como o resto da camada de UI — a conversão de centavos
// acontece na borda da API (ver `debtFromApi` em App.tsx).
export interface ProjectionPoint {
  /** Rótulo curto do mês para o eixo do gráfico (ex.: "out/26"). */
  name: string;
  /** Chave do mês em YYYY-MM — mesma convenção de `useFinancialStats.ts`. */
  month: string;
  /** Saldo projetado ao fim do mês (acumulado desde o saldo atual). */
  balance: number;
  /** Salário do mês, com o bônus quando ele cai no mês. */
  salaryDelta: number;
  /** Dívidas do mês: fatura do cartão, parcelas do cartão e parcelas das dívidas (positivo, é saída). */
  debtDelta: number;
}

export interface ProjectionOptions {
  /** Quantos meses projetar à frente, incluindo o mês corrente. Padrão: 6. */
  months?: number;
  /** Data-base da projeção (ISO YYYY-MM-DD). Padrão: hoje. Existe para os testes. */
  from?: string;
  /** Fatura do cartão do mês corrente (já lançada), que sai no primeiro mês. */
  currentBill?: number;
  /** Parcelas do cartão ainda não lançadas, cada uma no mês da sua data. */
  cardInstallments?: { date: string; amount: number }[];
}

/** Chave YYYY-MM de uma data ISO. */
function monthKey(dateISO: string): string {
  return dateISO.slice(0, 7);
}

/** Rótulo "out/26" a partir da chave YYYY-MM — mesmo formato de `balanceByMonth` no Dashboard. */
function monthLabel(month: string): string {
  // Dia 15 de propósito: `new Date('YYYY-MM-DD')` é interpretado como UTC, e o meio do mês
  // garante que nenhum fuso horário empurre o rótulo para o mês vizinho.
  return new Date(month + '-15').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}

/**
 * Projeta o saldo dos próximos meses: a cada mês entra o salário (e o bônus, no mês dele) e saem
 * as dívidas — a fatura atual do cartão no primeiro mês, as parcelas do cartão e as parcelas ainda
 * não pagas das dívidas cadastradas no mês em que vencem.
 *
 * Parcelas com data já vencida caem no primeiro mês: o dinheiro ainda não saiu da conta. A última
 * parcela de uma dívida é limitada ao saldo devedor (`remainingDebtSchedule`, em `debts.ts`).
 *
 * ponytail: o mês corrente conta o salário e as dívidas inteiros, como o card de sobra — se o
 * salário do mês já caiu na conta, ele entra duas vezes. Gastos futuros fora de parcelas e dívidas
 * (compras novas no cartão, contas do dia a dia) não entram.
 */
export function computeBalanceProjection(
  currentBalance: number,
  salary: Salary,
  debts: Debt[],
  options: ProjectionOptions = {}
): ProjectionPoint[] {
  const months = Math.max(1, options.months ?? 6);
  const from = options.from ?? todayISO();

  // Meses do horizonte, em ordem, começando pelo mês da data-base.
  const monthKeys: string[] = [];
  let cursor = from;
  for (let i = 0; i < months; i++) {
    monthKeys.push(monthKey(cursor));
    cursor = advanceMonth(cursor);
  }
  const firstMonth = monthKeys[0];
  const lastMonth = monthKeys[monthKeys.length - 1];

  const debtByMonth: Record<string, number> = { [firstMonth]: options.currentBill ?? 0 };
  const addDebt = (dateISO: string, amount: number) => {
    const key = monthKey(dateISO);
    if (key > lastMonth) return;
    const bucket = key < firstMonth ? firstMonth : key;
    debtByMonth[bucket] = (debtByMonth[bucket] ?? 0) + amount;
  };
  for (const installment of options.cardInstallments ?? []) addDebt(installment.date, installment.amount);
  for (const debt of debts) {
    for (const installment of remainingDebtSchedule(debt)) addDebt(installment.dueDate, installment.amount);
  }

  let running = currentBalance;
  return monthKeys.map(month => {
    const salaryDelta = salaryPerMonth(salary) + activeBonus(salary, month);
    const debtDelta = debtByMonth[month] ?? 0;
    running = running + salaryDelta - debtDelta;
    return {
      month,
      name: monthLabel(month),
      // Arredonda para centavos: somar/subtrair floats repetidamente acumula ruído de
      // ponto flutuante (a mesma razão de o banco guardar centavos — ver FIN-015).
      balance: Math.round(running * 100) / 100,
      salaryDelta,
      debtDelta: Math.round(debtDelta * 100) / 100,
    };
  });
}
