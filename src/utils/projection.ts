import type { Debt, RecurringTransaction } from '../types';
import { advanceMonth, advanceOccurrence } from './dates';
import { isDebtPaid, todayISO } from './debts';

// FIN-058 — projeção de saldo futuro: saldo atual + recorrências previstas − parcelas de
// dívidas previstas, mês a mês. Função pura, calculada no frontend a partir dos dados já
// carregados (não precisa de endpoint novo) e testável sem renderizar componentes.
//
// Todos os valores estão em REAIS, como o resto da camada de UI — a conversão de centavos
// acontece na borda da API (ver `debtFromApi`/`recurringFromApi` em App.tsx).
export interface ProjectionPoint {
  /** Rótulo curto do mês para o eixo do gráfico (ex.: "out/26"). */
  name: string;
  /** Chave do mês em YYYY-MM — mesma convenção de `useFinancialStats.ts`. */
  month: string;
  /** Saldo projetado ao fim do mês (acumulado desde o saldo atual). */
  balance: number;
  /** Soma das ocorrências de recorrências previstas para o mês (positivo = receita). */
  recurringDelta: number;
  /** Soma das parcelas de dívidas previstas para o mês (valor positivo, já é uma saída). */
  debtDelta: number;
}

export interface ProjectionOptions {
  /** Quantos meses projetar à frente, incluindo o mês corrente. Padrão: 6. */
  months?: number;
  /** Data-base da projeção (ISO YYYY-MM-DD). Padrão: hoje. Existe para os testes. */
  from?: string;
}

// Teto de iterações ao percorrer as ocorrências de uma recorrência dentro do horizonte.
// Uma recorrência semanal atrasada há anos geraria centenas de voltas; o horizonte já
// limita naturalmente, e este teto é a rede de segurança contra dado inesperado.
const MAX_OCCURRENCE_STEPS = 500;

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
 * Projeta o saldo dos próximos meses a partir do saldo atual, somando as ocorrências
 * previstas das recorrências ativas e subtraindo as parcelas ainda não pagas das dívidas.
 *
 * Recorrências e parcelas com data já vencida caem no primeiro mês da projeção: o dinheiro
 * ainda não saiu/entrou da conta, então continua sendo fluxo futuro do ponto de vista do
 * saldo atual.
 *
 * A última parcela de uma dívida é limitada ao saldo devedor restante
 * (`totalAmount − paidAmount`), e não a `monthlyPayment` cheio — do contrário a projeção
 * descontaria mais do que o usuário realmente ainda deve quando as parcelas têm
 * arredondamento (mesma regra de `computeNextInstallment` em `debts.ts`).
 */
export function computeBalanceProjection(
  currentBalance: number,
  recurring: RecurringTransaction[],
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

  const recurringByMonth: Record<string, number> = {};
  const debtByMonth: Record<string, number> = {};

  for (const rec of recurring) {
    if (!rec.active) continue;
    let occurrence = rec.nextOccurrence;
    for (let step = 0; step < MAX_OCCURRENCE_STEPS; step++) {
      const key = monthKey(occurrence);
      if (key > lastMonth) break;
      // Ocorrência atrasada (ainda não lançada) entra no primeiro mês do horizonte.
      const bucket = key < firstMonth ? firstMonth : key;
      recurringByMonth[bucket] = (recurringByMonth[bucket] ?? 0) + rec.amount;

      const next = advanceOccurrence(occurrence, rec.frequency);
      if (next <= occurrence) break; // dado inesperado: não avançaria, evita laço infinito
      occurrence = next;
    }
  }

  for (const debt of debts) {
    if (isDebtPaid(debt)) continue;
    const remainingInstallments = Math.max(0, debt.totalInstallments - debt.paidInstallments);
    let remainingBalance = Math.max(0, debt.totalAmount - debt.paidAmount);
    let dueDate = debt.nextDueDate;

    for (let i = 0; i < remainingInstallments && remainingBalance > 0; i++) {
      const installment = Math.min(debt.monthlyPayment, remainingBalance);
      const key = monthKey(dueDate);
      if (key > lastMonth) break;
      const bucket = key < firstMonth ? firstMonth : key;
      debtByMonth[bucket] = (debtByMonth[bucket] ?? 0) + installment;

      remainingBalance -= installment;
      dueDate = advanceMonth(dueDate);
    }
  }

  let running = currentBalance;
  return monthKeys.map(month => {
    const recurringDelta = recurringByMonth[month] ?? 0;
    const debtDelta = debtByMonth[month] ?? 0;
    running = running + recurringDelta - debtDelta;
    return {
      month,
      name: monthLabel(month),
      // Arredonda para centavos: somar/subtrair floats repetidamente acumula ruído de
      // ponto flutuante (a mesma razão de o banco guardar centavos — ver FIN-015).
      balance: Math.round(running * 100) / 100,
      recurringDelta,
      debtDelta,
    };
  });
}
