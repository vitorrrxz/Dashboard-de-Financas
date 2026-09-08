import { useMemo } from 'react';
import { isDebtOverdue, todayISO } from '../utils/debts';
import type { Account, Debt, Transaction } from '../types';

// FIN-086 — lógica de cálculo financeiro extraída de dentro de `App.tsx` (onde vivia como
// um `useMemo` inline de ~70 linhas) para este módulo dedicado. Objetivo duplo: (1)
// separar regra de negócio da camada de UI; (2) tornar a lógica testável sem precisar
// renderizar componentes React — ver `computeFinancialStats` abaixo, usado diretamente
// pelos testes de FIN-034 (`useFinancialStats.test.ts`).
//
// Todos os valores de entrada/saída estão em REAIS (não centavos) — a conversão para/de
// centavos acontece só na borda com a API (ver `accountFromApi`/`txFromApi` em App.tsx).
export interface FinancialStats {
  income: number;
  expense: number;
  importedBalance: number;
  balanceByMonth: { name: string; balance: number }[];
  dailyEvolution: { name: string; balance: number }[];
  expenseByCategory: { name: string; amount: number }[];
  monthExpense: number;
  realBalance: number;
  investmentBalance: number;
  pendingBills: number;
  activeDebts: number;
  overdueDebts: Debt[];
  filteredTxsCount: number;
}

export function computeFinancialStats(
  transactions: Transaction[],
  accounts: Account[],
  debts: Debt[],
  dashboardAccountId: string | null
): FinancialStats {
  const activeTxs = dashboardAccountId
    ? transactions.filter(t => t.accountId === dashboardAccountId)
    : transactions;

  const activeAccs = dashboardAccountId
    ? accounts.filter(a => a.id === dashboardAccountId)
    : accounts;

  const activeDebts = dashboardAccountId
    ? debts.filter(d => d.accountId === dashboardAccountId)
    : debts;

  const income = activeTxs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const expense = activeTxs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const importedBalance = income - expense;

  const monthMap: Record<string, number> = {};
  activeTxs.forEach(tx => {
    const m = tx.date.slice(0, 7);
    monthMap[m] = (monthMap[m] ?? 0) + tx.amount;
  });
  const balanceByMonth = Object.entries(monthMap)
    .sort(([a], [b]) => a.localeCompare(b)).slice(-7)
    .map(([k, v]) => ({
      name: new Date(k + '-15').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
      balance: +v.toFixed(2),
    }));

  const catMap: Record<string, number> = {};
  activeTxs.filter(t => t.amount < 0).forEach(t => {
    catMap[t.category] = (catMap[t.category] ?? 0) + Math.abs(t.amount);
  });
  const expenseByCategory = Object.entries(catMap)
    .sort(([, a], [, b]) => b - a).slice(0, 6)
    .map(([name, amount]) => ({ name, amount: +amount.toFixed(2) }));

  const today = todayISO();
  const mPrefix = today.slice(0, 7);
  const monthExpense = activeTxs.filter(t => t.amount < 0 && t.date.startsWith(mPrefix)).reduce((s, t) => s + Math.abs(t.amount), 0);

  // "Saldo Real" reflete apenas dinheiro líquido disponível (corrente/poupança/dinheiro).
  // Investimentos são somados separadamente — misturá-los ao saldo líquido pode enganar
  // o usuário sobre quanto ele realmente tem disponível para gastar (ver FIN-018).
  const realBalance = activeAccs.filter(a => a.type !== 'credit' && a.type !== 'investment').reduce((s, a) => s + a.balance, 0);
  const investmentBalance = activeAccs.filter(a => a.type === 'investment').reduce((s, a) => s + a.balance, 0);
  const pendingBills = activeAccs.filter(a => a.type === 'credit').reduce((s, a) => s + (a.pendingBill ?? 0), 0);
  const totalActiveDebts = activeDebts.reduce((s, d) => s + (d.totalAmount - d.paidAmount), 0);

  const overdueDebts = activeDebts.filter(isDebtOverdue);

  const dailyMap: Record<string, number> = {};
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const startStr = thirtyDaysAgo.toISOString().substring(0, 10);

  activeTxs.filter(t => t.date >= startStr).forEach(t => {
    dailyMap[t.date] = (dailyMap[t.date] ?? 0) + t.amount;
  });
  const dailyEvolution = Object.entries(dailyMap).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => {
    return { name: k.substring(5).replace('-', '/'), balance: v };
  });

  return {
    income, expense, importedBalance, balanceByMonth, dailyEvolution,
    expenseByCategory, monthExpense, realBalance, investmentBalance, pendingBills,
    activeDebts: totalActiveDebts, overdueDebts,
    filteredTxsCount: activeTxs.length,
  };
}

export function useFinancialStats(
  transactions: Transaction[],
  accounts: Account[],
  debts: Debt[],
  dashboardAccountId: string | null
): FinancialStats {
  return useMemo(
    () => computeFinancialStats(transactions, accounts, debts, dashboardAccountId),
    [transactions, accounts, debts, dashboardAccountId]
  );
}
