// FIN-034 (parte 2/2) — regras de negócio financeiras centrais do Dashboard, testando a
// função pura extraída em FIN-086 (não precisa renderizar componentes React).
import { describe, it, expect } from 'vitest';
import { computeFinancialStats } from './useFinancialStats';
import type { Account, Debt, Transaction } from '../types';

function tx(overrides: Partial<Transaction>): Transaction {
  return { id: Math.random().toString(), name: 'Tx', category: 'Outros', date: '2026-01-01', amount: 0, ...overrides };
}
function acc(overrides: Partial<Account>): Account {
  return { id: Math.random().toString(), name: 'Conta', bank: 'Banco', type: 'checking', balance: 0, color: '#fff', ...overrides };
}
function debt(overrides: Partial<Debt>): Debt {
  return {
    id: Math.random().toString(), name: 'Dívida', category: 'Pessoal',
    totalAmount: 0, paidAmount: 0, monthlyPayment: 0, totalInstallments: 1, paidInstallments: 0,
    nextDueDate: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}

describe('computeFinancialStats', () => {
  it('soma receita e despesa corretamente a partir de transações positivas/negativas', () => {
    const txs = [tx({ amount: 1000 }), tx({ amount: 500 }), tx({ amount: -300 }), tx({ amount: -200 })];
    const s = computeFinancialStats(txs, [], [], null);
    expect(s.income).toBe(1500);
    expect(s.expense).toBe(500);
    expect(s.importedBalance).toBe(1000);
  });

  it('saldo negativo quando despesas superam receitas', () => {
    const txs = [tx({ amount: 100 }), tx({ amount: -500 })];
    const s = computeFinancialStats(txs, [], [], null);
    expect(s.importedBalance).toBe(-400);
  });

  it('conta sem transações não gera erro e soma zero', () => {
    const s = computeFinancialStats([], [acc({ type: 'checking', balance: 0 })], [], null);
    expect(s.income).toBe(0);
    expect(s.expense).toBe(0);
    expect(s.realBalance).toBe(0);
    expect(s.filteredTxsCount).toBe(0);
  });

  it('cartão sem fatura pendente (pendingBill undefined) não gera NaN', () => {
    const s = computeFinancialStats([], [acc({ type: 'credit', balance: 0, pendingBill: undefined })], [], null);
    expect(s.pendingBills).toBe(0);
  });

  it('cartão com fatura pendente soma corretamente e não entra no saldo real', () => {
    const accounts = [
      acc({ type: 'credit', pendingBill: 1500 }),
      acc({ type: 'checking', balance: 2000 }),
    ];
    const s = computeFinancialStats([], accounts, [], null);
    expect(s.pendingBills).toBe(1500);
    expect(s.realBalance).toBe(2000); // cartão não entra no saldo real
  });

  it('contas de investimento ficam fora do saldo real, somadas separadamente (FIN-018)', () => {
    const accounts = [
      acc({ type: 'checking', balance: 1000 }),
      acc({ type: 'investment', balance: 5000 }),
    ];
    const s = computeFinancialStats([], accounts, [], null);
    expect(s.realBalance).toBe(1000);
    expect(s.investmentBalance).toBe(5000);
  });

  it('posições da carteira entram em Investimentos sem somar em dobro a conta coberta (FIN-073)', () => {
    const accounts = [acc({ id: 'xp', type: 'investment', balance: 10000 }), acc({ type: 'checking', balance: 1000 })];
    const s = computeFinancialStats([], accounts, [], null, [{ accountId: 'xp', currentValue: 9000 }, { currentValue: 500 }]);
    // Saldo da XP (10.000) + posições (9.500) daria 19.500: a conta com posições é representada por elas.
    expect(s.investmentBalance).toBe(9500);
    expect(s.realBalance).toBe(1000);
  });

  it('com uma conta selecionada, só entram as posições vinculadas a ela (FIN-073)', () => {
    const accounts = [acc({ id: 'xp', type: 'investment', balance: 10000 }), acc({ id: 'rico', type: 'investment', balance: 2000 })];
    const investments = [{ accountId: 'xp', currentValue: 9000 }, { accountId: 'rico', currentValue: 1500 }, { currentValue: 700 }];
    expect(computeFinancialStats([], accounts, [], 'xp', investments).investmentBalance).toBe(9000);
    expect(computeFinancialStats([], accounts, [], 'rico', investments).investmentBalance).toBe(1500);
  });

  it('múltiplas contas consolidadas (dashboardAccountId null) somam tudo', () => {
    const accounts = [acc({ id: 'a1', type: 'checking', balance: 100 }), acc({ id: 'a2', type: 'checking', balance: 200 })];
    const txs = [tx({ accountId: 'a1', amount: 50 }), tx({ accountId: 'a2', amount: 30 })];
    const s = computeFinancialStats(txs, accounts, [], null);
    expect(s.realBalance).toBe(300);
    expect(s.filteredTxsCount).toBe(2);
  });

  it('filtro por conta única (dashboardAccountId definido) considera só aquela conta', () => {
    const accounts = [acc({ id: 'a1', type: 'checking', balance: 100 }), acc({ id: 'a2', type: 'checking', balance: 200 })];
    const txs = [tx({ accountId: 'a1', amount: 50 }), tx({ accountId: 'a2', amount: 30 })];
    const s = computeFinancialStats(txs, accounts, [], 'a1');
    expect(s.realBalance).toBe(100);
    expect(s.filteredTxsCount).toBe(1);
    expect(s.income).toBe(50);
  });

  it('dívida vencida (usando a função unificada de FIN-005) aparece em overdueDebts', () => {
    // totalAmount/paidAmount explícitos e não-zero: com o default totalAmount:0 da fixture,
    // `paidAmount (0) >= totalAmount (0)` seria trivialmente verdadeiro (uma dívida de R$0 já
    // está "paga" por definição) e as duas primeiras dívidas cairiam incorretamente em
    // isDebtPaid — não reflete um caso real de uso (dívida sempre tem valor total > 0).
    const debts = [
      debt({ nextDueDate: '2020-01-01', paidInstallments: 0, totalInstallments: 5, totalAmount: 1000, paidAmount: 0 }), // vencida
      debt({ nextDueDate: '2099-01-01', paidInstallments: 0, totalInstallments: 5, totalAmount: 1000, paidAmount: 0 }), // em dia
      debt({ nextDueDate: '2020-01-01', paidInstallments: 5, totalInstallments: 5, totalAmount: 1000, paidAmount: 1000 }), // quitada, não conta
    ];
    const s = computeFinancialStats([], [], debts, null);
    expect(s.overdueDebts).toHaveLength(1);
  });

  it('dívida filtrada por conta única não conta dívidas de outras contas em activeDebts', () => {
    const debts = [
      debt({ accountId: 'a1', totalAmount: 1000, paidAmount: 200 }),
      debt({ accountId: 'a2', totalAmount: 500, paidAmount: 0 }),
    ];
    const s = computeFinancialStats([], [], debts, 'a1');
    expect(s.activeDebts).toBe(800); // só a dívida de a1: 1000 - 200
  });
});
