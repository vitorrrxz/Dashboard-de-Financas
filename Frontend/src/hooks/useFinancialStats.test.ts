// FIN-034 (parte 2/2) — regras de negócio financeiras centrais do Dashboard, testando a
// função pura extraída em FIN-086 (não precisa renderizar componentes React).
import { describe, it, expect } from 'vitest';
import { billPeriod, computeFinancialStats } from './useFinancialStats';
import { advanceDays, dateInMonth, shiftMonth } from '../utils/dates';
import { todayISO } from '../utils/debts';
import type { Account, Debt, RecurringTransaction, Transaction } from '../types';

function tx(overrides: Partial<Transaction>): Transaction {
  return { id: Math.random().toString(), name: 'Tx', category: 'Outros', date: '2026-01-01', amount: 0, ...overrides };
}
function acc(overrides: Partial<Account>): Account {
  return { id: Math.random().toString(), name: 'Conta', bank: 'Banco', type: 'checking', balance: 0, color: '#fff', ...overrides };
}
function rec(overrides: Partial<RecurringTransaction>): RecurringTransaction {
  return {
    id: Math.random().toString(), name: 'Aluguel', category: 'Moradia', amount: -1000, frequency: 'monthly',
    nextOccurrence: '2026-01-01', active: true, createdAt: '2026-01-01T00:00:00.000Z', ...overrides,
  };
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
    const s = computeFinancialStats([], [acc({ id: 'a1' }), acc({ id: 'a2' })], debts, 'a1');
    expect(s.activeDebts).toBe(800); // só a dívida de a1: 1000 - 200
  });
});

describe('transferências entre contas e pagamento de fatura (FIN-103)', () => {
  it('ficam fora de receitas, despesas, categorias e da evolução; o resto continua contando', () => {
    const today = todayISO();
    const txs = [
      tx({ date: today, amount: 1000, category: 'Receita' }),
      tx({ date: today, amount: -300, category: 'Alimentação' }),
      tx({ date: today, amount: -500, category: 'Transferência entre contas' }),
      tx({ date: today, amount: -400, category: 'Credit card payment' }),
      tx({ date: today, amount: 200, category: 'Same person transfer' }),
    ];
    const s = computeFinancialStats(txs, [], [], null);
    expect(s.income).toBe(1000);
    expect(s.expense).toBe(300);
    expect(s.monthExpense).toBe(300);
    expect(s.expenseByCategory).toEqual([{ name: 'Alimentação', amount: 300 }]);
    expect(s.balanceByMonth.map(m => m.balance)).toEqual([700]);
    expect(s.dailyEvolution.map(d => d.balance)).toEqual([700]);
  });
});

describe('computeFinancialStats — parcelas do mês', () => {
  it('soma a parcela mensal só das dívidas ainda não quitadas', () => {
    const debts = [
      debt({ monthlyPayment: 300, totalInstallments: 10, paidInstallments: 2 }),
      debt({ monthlyPayment: 200, totalInstallments: 5, paidInstallments: 5 }),
    ];
    expect(computeFinancialStats([], [], debts, null).monthDebtPayments).toBe(300);
  });
});

describe('computeFinancialStats — tudo o que se deve é dívida', () => {
  it('separa cartão de despesa e soma fatura, parcelas futuras e dívidas cadastradas', () => {
    const today = todayISO();
    const card = acc({ id: 'card', type: 'credit', pendingBill: 500 });
    const txs = [
      tx({ accountId: 'card', paymentType: 'credit', name: 'Loja 1/3', amount: -100, date: today }),
      tx({ accountId: 'card', paymentType: 'credit', name: 'Mercado', amount: -50, date: today }),
      tx({ accountId: 'chk', paymentType: 'pix', name: 'Padaria', amount: -30, date: today }),
    ];
    const debts = [debt({ totalAmount: 1000, paidAmount: 200, monthlyPayment: 100, totalInstallments: 10 })];
    const s = computeFinancialStats(txs, [card, acc({ id: 'chk' })], debts, null);
    expect(s.monthCardExpense).toBe(150);
    expect(s.monthExpense).toBe(180); // total gasto no mês: cartão + PIX
    expect(s.monthExpenseByType).toEqual({ debitPix: 30, credit: 50, installment: 100 });
    // Cartão (50 à vista + 100 parcelado) + dívida cadastrada em 10x (100).
    expect(s.monthDebtsByType).toEqual({ debitPix: 0, credit: 50, installment: 200 });
    // 800 cadastradas + 500 de fatura + 2 parcelas futuras de 100.
    expect(s.totalOwed).toBe(1500);
  });
});

describe('billPeriod — ciclo da fatura que vence no mês', () => {
  it('vencimento depois do fechamento: fecha no próprio mês', () => {
    expect(billPeriod('2026-10', 10, 20)).toEqual({ start: '2026-09-11', end: '2026-10-10' });
  });
  it('vencimento até o fechamento: fechou no mês anterior', () => {
    expect(billPeriod('2026-10', 28, 5)).toEqual({ start: '2026-08-29', end: '2026-09-28' });
  });
  it('fechamento no dia 31 respeita o tamanho do mês', () => {
    expect(billPeriod('2026-03', 31)).toEqual({ start: '2026-03-01', end: '2026-03-31' });
  });
  it('com fechamento cadastrado, só a compra dentro do ciclo entra nas dívidas do mês', () => {
    const card = acc({ id: 'card', type: 'credit', closingDay: 10, dueDay: 20 });
    const { end } = billPeriod(todayISO().slice(0, 7), 10, 20);
    const txs = [
      tx({ accountId: 'card', paymentType: 'credit', amount: -100, date: end }),
      tx({ accountId: 'card', paymentType: 'credit', amount: -40, date: advanceDays(end, 1) }),
    ];
    expect(computeFinancialStats(txs, [card], [], null).monthCardExpense).toBe(100);
  });
});

describe('computeFinancialStats — saídas por dia (sobra quinzenal)', () => {
  it('somam o mesmo que as dívidas do mês (cartão + parcelas), sem as despesas; cartão cai no vencimento', () => {
    const today = todayISO();
    const card = acc({ id: 'card', type: 'credit', dueDay: 10 });
    const txs = [
      tx({ accountId: 'card', paymentType: 'credit', amount: -100, date: today }),
      tx({ accountId: 'chk', paymentType: 'pix', amount: -30, date: today }),
    ];
    const debts = [debt({ monthlyPayment: 50, totalInstallments: 2, nextDueDate: `${today.slice(0, 7)}-25` })];
    const s = computeFinancialStats(txs, [card, acc({ id: 'chk' })], debts, null);
    const total = s.monthOutflows.reduce((sum, o) => sum + o.amount, 0);
    expect(total).toBe(s.monthCardExpense + s.monthDebtPayments);
    expect(s.monthOutflows).toContainEqual({ day: 10, amount: 100 });
    expect(s.monthOutflows).toContainEqual({ day: 25, amount: 50 });
  });
});

describe('computeFinancialStats — recorrências nas dívidas do mês', () => {
  const month = todayISO().slice(0, 7);
  const nextMonth = shiftMonth(month, 1);

  it('a que ainda vai cair no mês entra nas dívidas, na régua e em débito/PIX', () => {
    const s = computeFinancialStats([], [acc({ id: 'chk' })], [], null, [],
      [rec({ accountId: 'chk', amount: -1500, nextOccurrence: dateInMonth(month, 28) })]);
    expect(s.monthRecurring).toBe(1500);
    expect(s.monthOutflows).toContainEqual({ day: 28, amount: 1500 });
    expect(s.monthDebtsByType.debitPix).toBe(1500);
  });

  it('a já lançada no mês conta uma vez, pela transação gerada; outra despesa com nome diferente não conta', () => {
    const txs = [
      tx({ accountId: 'chk', name: 'Aluguel', amount: -1000, date: dateInMonth(month, 1) }),
      tx({ accountId: 'chk', name: 'Mercado', amount: -1000, date: dateInMonth(month, 1) }),
    ];
    const s = computeFinancialStats(txs, [acc({ id: 'chk' })], [], null, [],
      [rec({ accountId: 'chk', nextOccurrence: dateInMonth(nextMonth, 1) })]);
    expect(s.monthRecurring).toBe(1000);
    expect(s.monthOutflows).toEqual([{ day: 1, amount: 1000 }]);
  });

  it('semanal conta cada ocorrência que ainda cai no mês', () => {
    const s = computeFinancialStats([], [], [], null, [],
      [rec({ amount: -50, frequency: 'weekly', nextOccurrence: dateInMonth(month, 1) })]);
    // Do dia 1, de 7 em 7: 1, 8, 15, 22, 29 — o 29 só existe fora de fevereiro comum.
    const occurrences = [1, 8, 15, 22, 29].filter(d => dateInMonth(month, d).endsWith(String(d).padStart(2, '0')));
    expect(s.monthRecurring).toBe(50 * occurrences.length);
  });

  it('no cartão, a lançada já está na fatura (não soma de novo); a que vai cair nesta fatura entra como crédito', () => {
    const card = acc({ id: 'card', type: 'credit' });
    const launched = tx({ accountId: 'card', name: 'Streaming', amount: -40, date: dateInMonth(month, 1) });
    const s = computeFinancialStats([launched], [card], [], null, [], [
      rec({ accountId: 'card', name: 'Streaming', amount: -40, nextOccurrence: dateInMonth(nextMonth, 1) }),
      rec({ accountId: 'card', name: 'Academia', amount: -90, nextOccurrence: dateInMonth(month, 28) }),
    ]);
    expect(s.monthCardExpense).toBe(40);
    expect(s.monthRecurring).toBe(90);
    expect(s.monthDebtsByType.credit).toBe(130);
  });

  it('pausada, receita, de outro mês ou de outra conta filtrada não entram', () => {
    const s = computeFinancialStats([], [acc({ id: 'a' }), acc({ id: 'b' })], [], 'a', [], [
      rec({ accountId: 'a', active: false, nextOccurrence: dateInMonth(month, 28) }),
      rec({ accountId: 'a', amount: 3000, nextOccurrence: dateInMonth(month, 28) }),
      rec({ accountId: 'a', nextOccurrence: dateInMonth(nextMonth, 1) }),
      rec({ accountId: 'b', nextOccurrence: dateInMonth(month, 28) }),
    ]);
    expect(s.monthRecurring).toBe(0);
    expect(s.monthOutflows).toEqual([]);
  });
});

describe('computeFinancialStats — pagamento dividido', () => {
  it('cada parte entra no seu dia, somando a parcela', () => {
    const debts = [debt({
      monthlyPayment: 1000, totalInstallments: 3, nextDueDate: '2099-01-10',
      splits: [{ id: 's1', day: 10, amount: 600, paid: true }, { id: 's2', day: 25, amount: 400, paid: false }],
    })];
    const s = computeFinancialStats([], [], debts, null);
    expect(s.monthOutflows).toEqual([{ day: 10, amount: 600 }, { day: 25, amount: 400 }]);
    expect(s.monthDebtPayments).toBe(1000);
  });
});

