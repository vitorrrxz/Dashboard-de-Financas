// FIN-057/FIN-058 — projeção de saldo futuro. Todos os testes passam `from` explícito para
// não dependerem da data em que a suíte roda.
import { describe, it, expect } from 'vitest';
import { computeBalanceProjection } from './projection';
import type { Debt, RecurringTransaction } from '../types';

function rec(overrides: Partial<RecurringTransaction> = {}): RecurringTransaction {
  return {
    id: Math.random().toString(), name: 'Salário', category: 'Receita',
    amount: 5000, frequency: 'monthly', nextOccurrence: '2026-06-05',
    active: true, createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
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

describe('computeBalanceProjection', () => {
  it('sem recorrências nem dívidas, o saldo se mantém constante no horizonte', () => {
    const p = computeBalanceProjection(1000, [], [], { from: FROM, months: 3 });
    expect(p.map(x => x.month)).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(p.map(x => x.balance)).toEqual([1000, 1000, 1000]);
  });

  it('recorrência mensal de receita acumula mês a mês', () => {
    const p = computeBalanceProjection(0, [rec({ amount: 500, nextOccurrence: '2026-06-05' })], [], { from: FROM, months: 3 });
    expect(p.map(x => x.balance)).toEqual([500, 1000, 1500]);
  });

  it('recorrência de despesa (amount negativo) reduz o saldo', () => {
    const p = computeBalanceProjection(1000, [rec({ amount: -200, category: 'Moradia', nextOccurrence: '2026-06-05' })], [], { from: FROM, months: 2 });
    expect(p.map(x => x.balance)).toEqual([800, 600]);
  });

  it('recorrência inativa é ignorada', () => {
    const p = computeBalanceProjection(1000, [rec({ amount: 500, active: false })], [], { from: FROM, months: 2 });
    expect(p.map(x => x.balance)).toEqual([1000, 1000]);
  });

  it('recorrência semanal gera várias ocorrências no mesmo mês', () => {
    // 2026-06-01 é segunda; ocorrências em 01, 08, 15, 22 e 29 de junho = 5 no mês.
    const p = computeBalanceProjection(0, [rec({ amount: 100, frequency: 'weekly', nextOccurrence: '2026-06-01' })], [], { from: FROM, months: 1 });
    expect(p[0].recurringDelta).toBe(500);
  });

  it('recorrência anual só aparece no mês da data de ocorrência', () => {
    const p = computeBalanceProjection(0, [rec({ amount: 1200, frequency: 'yearly', nextOccurrence: '2026-08-10' })], [], { from: FROM, months: 4 });
    expect(p.map(x => x.recurringDelta)).toEqual([0, 0, 1200, 0]);
  });

  it('ocorrência atrasada (data já passada) entra no primeiro mês do horizonte, não é perdida', () => {
    const p = computeBalanceProjection(0, [rec({ amount: 300, nextOccurrence: '2026-04-05' })], [], { from: FROM, months: 2 });
    // Abril e maio (atrasadas) + junho caem no primeiro balde; julho no segundo.
    expect(p[0].recurringDelta).toBe(900);
    expect(p[1].recurringDelta).toBe(300);
  });

  it('parcelas de dívida ativa reduzem o saldo mês a mês', () => {
    const p = computeBalanceProjection(1000, [], [debt({ monthlyPayment: 100, nextDueDate: '2026-06-10' })], { from: FROM, months: 3 });
    expect(p.map(x => x.debtDelta)).toEqual([100, 100, 100]);
    expect(p.map(x => x.balance)).toEqual([900, 800, 700]);
  });

  it('dívida quitada é ignorada', () => {
    const p = computeBalanceProjection(1000, [], [debt({ paidInstallments: 12, totalInstallments: 12, paidAmount: 1200 })], { from: FROM, months: 2 });
    expect(p.map(x => x.debtDelta)).toEqual([0, 0]);
  });

  it('projeta apenas as parcelas que ainda faltam, não o total de parcelas', () => {
    // 12 parcelas, 10 pagas → só faltam 2, mesmo com horizonte de 5 meses.
    const p = computeBalanceProjection(1000, [], [debt({ paidInstallments: 10, paidAmount: 1000, monthlyPayment: 100 })], { from: FROM, months: 5 });
    expect(p.map(x => x.debtDelta)).toEqual([100, 100, 0, 0, 0]);
  });

  it('a última parcela é limitada ao saldo devedor, não ao valor cheio da parcela', () => {
    // Faltam R$ 150 (1000 − 850) mas a parcela nominal é R$ 100: 100 + 50, não 100 + 100.
    const p = computeBalanceProjection(1000, [], [
      debt({ totalAmount: 1000, paidAmount: 850, monthlyPayment: 100, totalInstallments: 10, paidInstallments: 8 }),
    ], { from: FROM, months: 3 });
    expect(p.map(x => x.debtDelta)).toEqual([100, 50, 0]);
  });

  it('combina saldo atual, recorrências e dívidas na mesma projeção', () => {
    const p = computeBalanceProjection(
      2000,
      [rec({ amount: 500, nextOccurrence: '2026-06-05' }), rec({ amount: -200, nextOccurrence: '2026-06-08' })],
      [debt({ monthlyPayment: 100, nextDueDate: '2026-06-10' })],
      { from: FROM, months: 2 }
    );
    // Cada mês: +500 −200 −100 = +200
    expect(p.map(x => x.balance)).toEqual([2200, 2400]);
  });

  it('respeita o horizonte pedido e rotula os meses para o gráfico', () => {
    const p = computeBalanceProjection(0, [], [], { from: '2026-11-01', months: 3 });
    expect(p).toHaveLength(3);
    expect(p.map(x => x.month)).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(p[0].name).toBeTruthy();
  });

  it('saldo negativo é projetado normalmente (não é zerado)', () => {
    const p = computeBalanceProjection(100, [rec({ amount: -400, nextOccurrence: '2026-06-05' })], [], { from: FROM, months: 2 });
    expect(p.map(x => x.balance)).toEqual([-300, -700]);
  });
});
