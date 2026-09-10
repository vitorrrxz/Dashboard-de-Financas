// FIN-093 — filtro por mês de referência e totais da aba Transações.
//
// A lógica vive aqui (e não dentro de `App.tsx`) pelo mesmo motivo de
// `useFinancialStats`: é regra de negócio pura, testável sem renderizar React.
// Todos os valores estão em REAIS — a conversão de centavos acontece na borda da API.

import type { Transaction } from '../types';
import { monthsDescending } from './dates';

/** Filtro de tipo aplicado pelos botões "Todas / Receitas / Despesas". */
export type TransactionKind = 'all' | 'income' | 'expense';

/** Valor sentinela do seletor de mês que desliga o recorte mensal. */
export const ALL_MONTHS = 'all';

export interface TransactionTotals {
  /** Soma das entradas (valores positivos). */
  income: number;
  /** Soma das saídas, em módulo (sempre >= 0). */
  expense: number;
  /** `income - expense` — o "valor total" do mês de referência. */
  balance: number;
  /** Quantidade de transações somadas. */
  count: number;
}

/**
 * Meses (`YYYY-MM`) que aparecem nas transações, do mais recente para o mais antigo.
 *
 * `alwaysInclude` garante que o mês corrente continue selecionável mesmo quando ainda não
 * há nenhum lançamento nele — sem isso, o seletor abriria num mês que não existe na lista
 * e o usuário não teria como voltar para ele.
 */
export function availableMonths(transactions: Transaction[], alwaysInclude?: string): string[] {
  return monthsDescending(transactions.map(t => t.date), alwaysInclude);
}

/**
 * Aplica o recorte de mês de referência e a busca textual — o conjunto sobre o qual os
 * totais são calculados. O filtro de tipo (receita/despesa) fica de fora de propósito:
 * o resumo precisa continuar mostrando os dois lados mesmo quando a lista isola um deles.
 */
export function filterByMonthAndSearch(
  transactions: Transaction[],
  month: string,
  search: string
): Transaction[] {
  const query = search.trim().toLowerCase();
  return transactions.filter(t => {
    if (month !== ALL_MONTHS && !t.date.startsWith(month)) return false;
    if (!query) return true;
    return t.name.toLowerCase().includes(query) || t.category.toLowerCase().includes(query);
  });
}

/** Aplica o filtro "Todas / Receitas / Despesas" a um conjunto já recortado por mês/busca. */
export function filterByKind(transactions: Transaction[], kind: TransactionKind): Transaction[] {
  if (kind === 'income')  return transactions.filter(t => t.amount > 0);
  if (kind === 'expense') return transactions.filter(t => t.amount < 0);
  return transactions;
}

/**
 * Soma receitas, despesas e saldo de um conjunto de transações.
 *
 * Transações de valor zero não entram em nenhum dos dois lados (não são entrada nem
 * saída), mas continuam contadas em `count` — que descreve o recorte, não o dinheiro.
 */
export function summarizeTransactions(transactions: Transaction[]): TransactionTotals {
  let income = 0;
  let expense = 0;
  for (const t of transactions) {
    if (t.amount > 0) income += t.amount;
    else if (t.amount < 0) expense += Math.abs(t.amount);
  }
  return { income, expense, balance: income - expense, count: transactions.length };
}
