// FIN-048 (parte 1/2) — cálculo de progresso do orçamento (FIN-044).
import { describe, it, expect } from 'vitest';
import { computeBudgetProgress } from './budget';
import type { Transaction, Budget } from '../types';

function tx(overrides: Partial<Transaction>): Transaction {
  return { id: Math.random().toString(), name: 'Tx', category: 'Outros', date: '2026-06-01', amount: 0, ...overrides };
}
function budget(overrides: Partial<Budget>): Budget {
  return { id: Math.random().toString(), category: 'Alimentação', monthlyLimit: 500, createdAt: '2026-01-01T00:00:00.000Z', ...overrides };
}

describe('computeBudgetProgress', () => {
  it('soma apenas despesas (amount < 0) da categoria no mês informado', () => {
    const txs = [
      tx({ category: 'Alimentação', amount: -100, date: '2026-06-05' }),
      tx({ category: 'Alimentação', amount: -50, date: '2026-06-10' }),
      tx({ category: 'Alimentação', amount: 200, date: '2026-06-10' }), // receita, não conta
      tx({ category: 'Transporte', amount: -30, date: '2026-06-10' }), // outra categoria, não conta
      tx({ category: 'Alimentação', amount: -999, date: '2026-05-30' }), // mês errado, não conta
    ];
    const budgets = [budget({ category: 'Alimentação', monthlyLimit: 500 })];
    const [progress] = computeBudgetProgress(txs, budgets, '2026-06');
    expect(progress.spent).toBe(150);
    expect(progress.limit).toBe(500);
    expect(progress.percentage).toBe(30);
    expect(progress.isOverLimit).toBe(false);
  });

  it('marca isOverLimit quando o gasto excede o limite, com percentage > 100', () => {
    const txs = [tx({ category: 'Lazer', amount: -600, date: '2026-06-05' })];
    const budgets = [budget({ category: 'Lazer', monthlyLimit: 500 })];
    const [progress] = computeBudgetProgress(txs, budgets, '2026-06');
    expect(progress.isOverLimit).toBe(true);
    expect(progress.percentage).toBe(120);
  });

  it('categoria sem nenhuma transação no mês tem spent 0 e percentage 0', () => {
    const budgets = [budget({ category: 'Educação', monthlyLimit: 300 })];
    const [progress] = computeBudgetProgress([], budgets, '2026-06');
    expect(progress.spent).toBe(0);
    expect(progress.percentage).toBe(0);
    expect(progress.isOverLimit).toBe(false);
  });

  it('retorna um item por orçamento, na mesma ordem, mesmo com categorias distintas', () => {
    const txs = [tx({ category: 'Alimentação', amount: -100, date: '2026-06-01' })];
    const budgets = [
      budget({ category: 'Alimentação', monthlyLimit: 200 }),
      budget({ category: 'Transporte', monthlyLimit: 100 }),
    ];
    const progress = computeBudgetProgress(txs, budgets, '2026-06');
    expect(progress).toHaveLength(2);
    expect(progress[0].category).toBe('Alimentação');
    expect(progress[1].category).toBe('Transporte');
    expect(progress[1].spent).toBe(0);
  });
});
