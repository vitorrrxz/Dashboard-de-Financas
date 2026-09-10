// FIN-034 (parte 1/2) — regras de negócio de dívidas: vencimento, avanço de parcela.
import { describe, it, expect } from 'vitest';
import { isDebtPaid, isDebtOverdue, computeNextInstallment } from './debts';
import type { Debt } from '../types';

function makeDebt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: '1', name: 'Dívida Teste', category: 'Pessoal',
    totalAmount: 1000, paidAmount: 0, monthlyPayment: 100,
    totalInstallments: 10, paidInstallments: 0,
    nextDueDate: '2026-06-15', createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('isDebtPaid', () => {
  it('não paga quando paidInstallments < totalInstallments e paidAmount < totalAmount', () => {
    expect(isDebtPaid(makeDebt({ paidInstallments: 5, totalInstallments: 10, paidAmount: 500, totalAmount: 1000 }))).toBe(false);
  });
  it('paga quando paidInstallments === totalInstallments, mesmo com paidAmount ainda abaixo de totalAmount', () => {
    // paidAmount < totalAmount de propósito — isola a condição de parcelas (o teste
    // anterior já cobre paidAmount atingindo totalAmount antes da última parcela).
    expect(isDebtPaid(makeDebt({ paidInstallments: 10, totalInstallments: 10, paidAmount: 900, totalAmount: 1000 }))).toBe(true);
  });
  it('paga quando paidAmount atinge totalAmount antes da última parcela nominal (arredondamento acumulado)', () => {
    expect(isDebtPaid(makeDebt({ paidInstallments: 9, totalInstallments: 10, paidAmount: 1000, totalAmount: 1000 }))).toBe(true);
  });
});

describe('isDebtOverdue', () => {
  it('dívida com vencimento no passado e não quitada está vencida', () => {
    expect(isDebtOverdue(makeDebt({ nextDueDate: '2020-01-01', paidInstallments: 0, totalInstallments: 10 }))).toBe(true);
  });
  it('dívida com vencimento no futuro não está vencida', () => {
    expect(isDebtOverdue(makeDebt({ nextDueDate: '2099-01-01', paidInstallments: 0, totalInstallments: 10 }))).toBe(false);
  });
  it('dívida quitada nunca está vencida, mesmo com data no passado', () => {
    expect(isDebtOverdue(makeDebt({ nextDueDate: '2020-01-01', paidInstallments: 10, totalInstallments: 10 }))).toBe(false);
  });
  it('dívida com vencimento hoje NÃO está vencida (vence hoje, não antes)', () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(isDebtOverdue(makeDebt({ nextDueDate: iso, paidInstallments: 0, totalInstallments: 10 }))).toBe(false);
  });
});

describe('computeNextInstallment', () => {
  it('avança paidInstallments em 1 e soma monthlyPayment a paidAmount', () => {
    const r = computeNextInstallment(makeDebt({ paidInstallments: 2, paidAmount: 200, monthlyPayment: 100, totalInstallments: 10, totalAmount: 1000, nextDueDate: '2026-03-15' }));
    expect(r).toEqual({ paidInstallments: 3, paidAmount: 300, nextDueDate: '2026-04-15' });
  });

  it('a última parcela fecha exatamente em totalAmount, mesmo que a soma acumulada ultrapasse', () => {
    // 9 parcelas de 111 = 999; 10ª parcela deveria fechar em 1000, não 1110
    const r = computeNextInstallment(makeDebt({ paidInstallments: 9, paidAmount: 999, monthlyPayment: 111, totalInstallments: 10, totalAmount: 1000, nextDueDate: '2026-03-15' }));
    expect(r.paidInstallments).toBe(10);
    expect(r.paidAmount).toBe(1000);
  });

  it('parcela intermediária nunca ultrapassa totalAmount (cap de segurança)', () => {
    const r = computeNextInstallment(makeDebt({ paidInstallments: 1, paidAmount: 950, monthlyPayment: 100, totalInstallments: 10, totalAmount: 1000, nextDueDate: '2026-03-15' }));
    expect(r.paidAmount).toBe(1000); // 950 + 100 = 1050, capado em 1000
    expect(r.paidInstallments).toBe(2); // ainda não é a última parcela nominal
  });
});
