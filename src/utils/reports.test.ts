// FIN-062/FIN-063/FIN-064 — agregações da aba Relatórios.
import { describe, it, expect } from 'vitest';
import { computeMonthlyComparison, computeYearlyComparison, computeNetWorth, transactionsPeriod } from './reports';
import type { Account, Debt, Transaction } from '../types';

function tx(overrides: Partial<Transaction>): Transaction {
  return { id: Math.random().toString(), name: 'Tx', category: 'Outros', date: '2026-06-01', amount: 0, ...overrides };
}
function acc(overrides: Partial<Account>): Account {
  return { id: Math.random().toString(), name: 'Conta', bank: 'Banco', type: 'checking', balance: 0, color: '#fff', ...overrides };
}
function debt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: Math.random().toString(), name: 'Dívida', category: 'Pessoal',
    totalAmount: 1000, paidAmount: 0, monthlyPayment: 100,
    totalInstallments: 10, paidInstallments: 0,
    nextDueDate: '2026-06-10', createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('computeMonthlyComparison', () => {
  it('separa receitas de despesas por mês e calcula o saldo', () => {
    const r = computeMonthlyComparison([
      tx({ date: '2026-06-05', amount: 5000 }),
      tx({ date: '2026-06-10', amount: -1200 }),
      tx({ date: '2026-06-20', amount: -800 }),
      tx({ date: '2026-07-05', amount: 5000 }),
    ]);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ period: '2026-06', income: 5000, expense: 2000, balance: 3000 });
    expect(r[1]).toMatchObject({ period: '2026-07', income: 5000, expense: 0, balance: 5000 });
  });

  it('ordena do mês mais antigo para o mais recente, independentemente da ordem de entrada', () => {
    const r = computeMonthlyComparison([
      tx({ date: '2026-08-01', amount: 100 }),
      tx({ date: '2026-01-01', amount: 100 }),
      tx({ date: '2026-05-01', amount: 100 }),
    ]);
    expect(r.map(x => x.period)).toEqual(['2026-01', '2026-05', '2026-08']);
  });

  it('mantém apenas os N meses mais recentes quando há histórico longo', () => {
    const txs = Array.from({ length: 20 }, (_, i) =>
      tx({ date: `2025-${String((i % 12) + 1).padStart(2, '0')}-01`, amount: 100 })
    );
    const r = computeMonthlyComparison(txs, 6);
    expect(r).toHaveLength(6);
    // O corte é no fim: sobram os meses mais recentes.
    expect(r[r.length - 1].period).toBe('2025-12');
  });

  it('transação de valor zero não vira receita nem despesa relevante', () => {
    const r = computeMonthlyComparison([tx({ date: '2026-06-01', amount: 0 })]);
    expect(r[0].income).toBe(0);
    expect(r[0].expense).toBe(0);
  });

  it('lista vazia devolve array vazio, sem quebrar', () => {
    expect(computeMonthlyComparison([])).toEqual([]);
  });

  it('atravessa a virada de ano na ordem correta', () => {
    const r = computeMonthlyComparison([
      tx({ date: '2027-01-10', amount: 100 }),
      tx({ date: '2026-12-10', amount: 200 }),
    ]);
    expect(r.map(x => x.period)).toEqual(['2026-12', '2027-01']);
  });
});

describe('computeYearlyComparison', () => {
  it('agrega por ano somando todos os meses', () => {
    const r = computeYearlyComparison([
      tx({ date: '2025-03-01', amount: 1000 }),
      tx({ date: '2025-09-01', amount: -400 }),
      tx({ date: '2026-02-01', amount: 2000 }),
    ]);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ period: '2025', label: '2025', income: 1000, expense: 400, balance: 600 });
    expect(r[1]).toMatchObject({ period: '2026', income: 2000, expense: 0, balance: 2000 });
  });

  it('ano com mais despesa que receita tem saldo negativo', () => {
    const r = computeYearlyComparison([
      tx({ date: '2026-01-01', amount: 500 }),
      tx({ date: '2026-02-01', amount: -900 }),
    ]);
    expect(r[0].balance).toBe(-400);
  });
});

describe('computeNetWorth', () => {
  it('soma ativos e subtrai passivos', () => {
    const r = computeNetWorth(
      [
        acc({ type: 'checking', balance: 3000 }),
        acc({ type: 'savings', balance: 2000 }),
        acc({ type: 'investment', balance: 10000 }),
        acc({ type: 'credit', pendingBill: 1500 }),
      ],
      [debt({ totalAmount: 5000, paidAmount: 1000 })]
    );
    expect(r.liquid).toBe(5000);
    expect(r.investments).toBe(10000);
    expect(r.pendingBills).toBe(1500);
    expect(r.debts).toBe(4000);
    expect(r.assets).toBe(15000);
    expect(r.liabilities).toBe(5500);
    expect(r.total).toBe(9500);
  });

  it('cartão de crédito não entra como ativo, mesmo com saldo preenchido (FIN-018)', () => {
    const r = computeNetWorth([acc({ type: 'credit', balance: 9999, pendingBill: 200 })], []);
    expect(r.liquid).toBe(0);
    expect(r.investments).toBe(0);
    expect(r.pendingBills).toBe(200);
    expect(r.total).toBe(-200);
  });

  it('cartão sem fatura preenchida não vira NaN', () => {
    const r = computeNetWorth([acc({ type: 'credit', pendingBill: undefined })], []);
    expect(r.pendingBills).toBe(0);
    expect(Number.isNaN(r.total)).toBe(false);
  });

  it('dívida quitada não entra no passivo', () => {
    const r = computeNetWorth(
      [acc({ type: 'checking', balance: 1000 })],
      [debt({ totalAmount: 500, paidAmount: 500, paidInstallments: 10, totalInstallments: 10 })]
    );
    expect(r.debts).toBe(0);
    expect(r.total).toBe(1000);
  });

  it('dívida com valor pago maior que o total não vira ativo fantasma', () => {
    const r = computeNetWorth(
      [acc({ type: 'checking', balance: 1000 })],
      // Dado inconsistente de propósito: pago 1200 de uma dívida de 1000.
      [debt({ totalAmount: 1000, paidAmount: 1200, paidInstallments: 3, totalInstallments: 10 })]
    );
    expect(r.debts).toBe(0);
    expect(r.total).toBe(1000);
  });

  it('patrimônio negativo quando os passivos superam os ativos', () => {
    const r = computeNetWorth(
      [acc({ type: 'checking', balance: 500 })],
      [debt({ totalAmount: 3000, paidAmount: 0 })]
    );
    expect(r.total).toBe(-2500);
  });

  it('sem contas nem dívidas, tudo é zero', () => {
    const r = computeNetWorth([], []);
    expect(r).toMatchObject({ liquid: 0, investments: 0, pendingBills: 0, debts: 0, total: 0 });
  });
});

describe('transactionsPeriod', () => {
  it('devolve a menor e a maior data do conjunto', () => {
    const p = transactionsPeriod([
      tx({ date: '2026-05-10' }),
      tx({ date: '2026-01-02' }),
      tx({ date: '2026-09-30' }),
    ]);
    expect(p).toEqual({ from: '2026-01-02', to: '2026-09-30' });
  });

  it('sem transações, usa a data de hoje nos dois extremos (não quebra o cabeçalho do relatório)', () => {
    const p = transactionsPeriod([]);
    expect(p.from).toBe(p.to);
    expect(p.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
