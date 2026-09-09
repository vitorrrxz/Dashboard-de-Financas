import type { Budget, Transaction } from '../types';

// FIN-044 — progresso do orçamento (gasto vs. limite por categoria/mês). Função pura,
// sem dependência de estado do componente, para ficar testável isoladamente (ver
// FIN-048 em docs/BACKLOG_DETAIL.md) e reutilizável tanto pela aba "Orçamento"
// (FIN-045) quanto pelo indicador do Dashboard (FIN-046).
export interface BudgetProgress {
  id: string;
  category: string;
  limit: number;
  spent: number;
  /** 0-100+ — pode passar de 100 quando o gasto excede o limite (ver FIN-047). */
  percentage: number;
  isOverLimit: boolean;
}

/**
 * Calcula, para cada orçamento cadastrado, quanto já foi gasto na categoria
 * correspondente dentro do mês informado (`month` no formato `YYYY-MM`, mesma
 * convenção usada em `useFinancialStats.ts`). Só considera transações de despesa
 * (`amount < 0`) — receitas não consomem orçamento.
 *
 * `monthlyLimit` é validado como > 0 no backend (ver `budgetSchema` em server.js), então
 * a divisão abaixo nunca opera sobre um limite zerado.
 */
export function computeBudgetProgress(
  transactions: Pick<Transaction, 'category' | 'amount' | 'date'>[],
  budgets: Pick<Budget, 'id' | 'category' | 'monthlyLimit'>[],
  month: string
): BudgetProgress[] {
  const spentByCategory: Record<string, number> = {};
  for (const tx of transactions) {
    if (tx.amount >= 0) continue;
    if (!tx.date.startsWith(month)) continue;
    spentByCategory[tx.category] = (spentByCategory[tx.category] ?? 0) + Math.abs(tx.amount);
  }

  return budgets.map(b => {
    const spent = spentByCategory[b.category] ?? 0;
    const percentage = (spent / b.monthlyLimit) * 100;
    return {
      id: b.id,
      category: b.category,
      limit: b.monthlyLimit,
      spent,
      percentage,
      isOverLimit: spent > b.monthlyLimit,
    };
  });
}
