// FIN-057/FIN-058 — projeção de saldo futuro. Todos os testes passam `from` explícito para
// não dependerem da data em que a suíte roda.
import { describe, it, expect } from 'vitest';
import { computeBalanceProjection } from './projection';
import type { Debt, RecurringTransaction, Salary } from '../types';

function salary(overrides: Partial<Salary> = {}): Salary {
  return { amount: 0, secondAmount: 0, frequency: 'monthly', payDay: 15, extras: [], ...overrides };
}

function debt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: Math.random().toString(), name: 'Financiamento', category: 'Financiamento',
    totalAmount: 1200, paidAmount: 0, monthlyPayment: 100,
    totalInstallments: 12, paidInstallments: 0,
    nextDueDate: '2026-06-10', createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const FROM = '2026-06-01';
const NO_SALARY = salary();

describe('computeBalanceProjection', () => {
  it('sem salário nem dívidas, o saldo se mantém constante no horizonte', () => {
    const p = computeBalanceProjection(1000, NO_SALARY, [], { from: FROM, months: 3 });
    expect(p.map(x => x.month)).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(p.map(x => x.balance)).toEqual([1000, 1000, 1000]);
  });

  it('salário mensal acumula mês a mês; quinzenal conta dois pagamentos', () => {
    expect(computeBalanceProjection(0, salary({ amount: 500 }), [], { from: FROM, months: 3 }).map(x => x.balance))
      .toEqual([500, 1000, 1500]);
    expect(computeBalanceProjection(0, salary({ amount: 500, secondAmount: 500, frequency: 'biweekly' }), [], { from: FROM, months: 2 }).map(x => x.balance))
      .toEqual([1000, 2000]);
  });

  it('as receitas extras entram no mês delas', () => {
    const extras = [
      { name: 'PLR', amount: 300, month: '2026-06', half: 1 as const, yearly: false },
      { name: '13º', amount: 500, month: '2026-07', half: 2 as const, yearly: true },
    ];
    const p = computeBalanceProjection(0, salary({ amount: 1000, extras }), [], { from: FROM, months: 3 });
    expect(p.map(x => x.salaryDelta)).toEqual([1300, 1500, 1000]);
  });

  it('a fatura atual do cartão sai no primeiro mês e as parcelas futuras no mês delas', () => {
    const p = computeBalanceProjection(1000, NO_SALARY, [], {
      from: FROM, months: 3, currentBill: 200,
      cardInstallments: [{ date: '2026-06-20', amount: 50 }, { date: '2026-07-20', amount: 50 }, { date: '2026-12-20', amount: 50 }],
    });
    expect(p.map(x => x.debtDelta)).toEqual([250, 50, 0]);
    expect(p.map(x => x.balance)).toEqual([750, 700, 700]);
  });

  it('parcelas de dívida ativa reduzem o saldo mês a mês', () => {
    const p = computeBalanceProjection(1000, NO_SALARY, [debt({ monthlyPayment: 100, nextDueDate: '2026-06-10' })], { from: FROM, months: 3 });
    expect(p.map(x => x.debtDelta)).toEqual([100, 100, 100]);
    expect(p.map(x => x.balance)).toEqual([900, 800, 700]);
  });

  it('parcela atrasada (data já passada) entra no primeiro mês do horizonte, não é perdida', () => {
    const p = computeBalanceProjection(1000, NO_SALARY, [debt({ nextDueDate: '2026-04-10' })], { from: FROM, months: 2 });
    // Abril, maio e junho caem no primeiro balde; julho no segundo.
    expect(p.map(x => x.debtDelta)).toEqual([300, 100]);
  });

  it('dívida quitada é ignorada', () => {
    const p = computeBalanceProjection(1000, NO_SALARY, [debt({ paidInstallments: 12, totalInstallments: 12, paidAmount: 1200 })], { from: FROM, months: 2 });
    expect(p.map(x => x.debtDelta)).toEqual([0, 0]);
  });

  it('projeta apenas as parcelas que ainda faltam, não o total de parcelas', () => {
    // 12 parcelas, 10 pagas → só faltam 2, mesmo com horizonte de 5 meses.
    const p = computeBalanceProjection(1000, NO_SALARY, [debt({ paidInstallments: 10, paidAmount: 1000, monthlyPayment: 100 })], { from: FROM, months: 5 });
    expect(p.map(x => x.debtDelta)).toEqual([100, 100, 0, 0, 0]);
  });

  it('a última parcela é limitada ao saldo devedor, não ao valor cheio da parcela', () => {
    // Faltam R$ 150 (1000 − 850) mas a parcela nominal é R$ 100: 100 + 50, não 100 + 100.
    const p = computeBalanceProjection(1000, NO_SALARY, [
      debt({ totalAmount: 1000, paidAmount: 850, monthlyPayment: 100, totalInstallments: 10, paidInstallments: 8 }),
    ], { from: FROM, months: 3 });
    expect(p.map(x => x.debtDelta)).toEqual([100, 50, 0]);
  });

  it('combina saldo atual, salário e dívidas: cada mês soma a sobra (salário − dívidas)', () => {
    const p = computeBalanceProjection(2000, salary({ amount: 500 }), [debt({ monthlyPayment: 100, nextDueDate: '2026-06-10' })], {
      from: FROM, months: 2, currentBill: 200,
    });
    // Junho: +500 −100 −200 = +200; julho: +500 −100 = +400.
    expect(p.map(x => x.balance)).toEqual([2200, 2600]);
  });

  it('respeita o horizonte pedido e rotula os meses para o gráfico', () => {
    const p = computeBalanceProjection(0, NO_SALARY, [], { from: '2026-11-01', months: 3 });
    expect(p).toHaveLength(3);
    expect(p.map(x => x.month)).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(p[0].name).toBeTruthy();
  });

  it('saldo negativo é projetado normalmente (não é zerado)', () => {
    const p = computeBalanceProjection(100, NO_SALARY, [debt({ monthlyPayment: 400, totalAmount: 4800 })], { from: FROM, months: 2 });
    expect(p.map(x => x.balance)).toEqual([-300, -700]);
  });

  it('recorrências: o mês corrente vem pronto; dos seguintes saem as despesas e entram as receitas não lançadas', () => {
    const recurring: RecurringTransaction[] = [
      { id: 'r1', name: 'Aluguel', category: 'Moradia', amount: -1000, frequency: 'monthly', nextOccurrence: '2026-07-05', active: true, createdAt: '2026-01-01' },
      { id: 'r2', name: 'Freela', category: 'Receita', amount: 500, frequency: 'monthly', nextOccurrence: '2026-07-05', active: true, createdAt: '2026-01-01' },
      { id: 'r3', name: 'Pausada', category: 'Outros', amount: -200, frequency: 'monthly', nextOccurrence: '2026-07-05', active: false, createdAt: '2026-01-01' },
    ];
    const p = computeBalanceProjection(5000, NO_SALARY, [], { from: FROM, months: 3, currentRecurring: 1000, currentRecurringIncome: 200, recurring });
    expect(p.map(x => x.debtDelta)).toEqual([1000, 1000, 1000]);
    expect(p.map(x => x.salaryDelta)).toEqual([200, 500, 500]);
    expect(p.map(x => x.balance)).toEqual([4200, 3700, 3200]);
  });

  it('devedor vinculado a uma dívida só entra até a última parcela dela; de dívida quitada, nunca', () => {
    // Faltam 2 parcelas (jun e jul): o devedor paga em jul e não mais em ago.
    const alternador = debt({ id: 'd1', totalAmount: 1000, paidAmount: 800, totalInstallments: 10, paidInstallments: 8, nextDueDate: '2026-06-15' });
    const quitada = debt({ id: 'd2', totalAmount: 100, paidAmount: 100, totalInstallments: 1, paidInstallments: 1 });
    const recurring: RecurringTransaction[] = [
      { id: 'r1', name: 'Amigo', category: 'Receita', amount: 100, frequency: 'monthly', nextOccurrence: '2026-07-15', active: true, debtId: 'd1', createdAt: '2026-01-01' },
      { id: 'r2', name: 'Outro', category: 'Receita', amount: 50, frequency: 'monthly', nextOccurrence: '2026-07-15', active: true, debtId: 'd2', createdAt: '2026-01-01' },
    ];
    const p = computeBalanceProjection(0, NO_SALARY, [alternador, quitada], { from: FROM, months: 3, recurring });
    expect(p.map(x => x.salaryDelta)).toEqual([0, 100, 0]);
  });
});
