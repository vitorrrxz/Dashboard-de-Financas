// Devedores de uma cobrança não cadastrada: compras do cartão que dá para vincular e o limite de pagamentos.
import { describe, it, expect } from 'vitest';
import { debtorCharges, pendingPixPayment, recurringIncomes, upcomingRecurringInflows } from './recurring';
import type { Account, RecurringTransaction, Transaction } from '../types';

const card: Account = { id: 'card', name: 'Cartão', bank: 'Nubank', type: 'credit', balance: 0, color: '#fff' };
const checking: Account = { id: 'cc', name: 'Conta', bank: 'Nubank', type: 'checking', balance: 0, color: '#fff' };

function tx(overrides: Partial<Transaction>): Transaction {
  return { id: overrides.name ?? 't', name: 'Compra', category: 'Compras', date: '2026-10-05', amount: -100, accountId: 'card', paymentType: 'credit', ...overrides };
}

function debtor(overrides: Partial<RecurringTransaction> = {}): RecurringTransaction {
  return {
    id: 'r1', name: 'Maria', category: 'Receita', amount: 150, frequency: 'monthly', nextOccurrence: '2026-11-10',
    active: true, createdAt: '2026-10-01', ...overrides,
  };
}

describe('debtorCharges', () => {
  const today = '2026-10-22';

  it('lista a compra parcelada uma vez, com as parcelas deste mês em diante como pagamentos', () => {
    const charges = debtorCharges([
      tx({ id: 'p1', name: 'Loja X 1/3', date: '2026-09-05', amount: -150 }),
      tx({ id: 'p2', name: 'Loja X 2/3', date: '2026-10-05', amount: -150 }),
      tx({ id: 'p3', name: 'Loja X 3/3', date: '2026-11-05', amount: -150 }),
    ], [card], today);
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ name: 'Loja X · 3x', amount: 150, payments: 2, date: '2026-09-05' });
  });

  it('compra à vista no cartão é um pagamento só; fica de fora a da conta corrente, a antiga e o pagamento de fatura', () => {
    const charges = debtorCharges([
      tx({ name: 'Restaurante', date: '2026-10-20', amount: -80 }),
      tx({ name: 'Mercado', date: '2026-10-21', amount: -50, accountId: 'cc', paymentType: 'debit' }),
      tx({ name: 'Antiga', date: '2026-05-01', amount: -30 }),
      tx({ name: 'Fatura', date: '2026-10-10', amount: -500, category: 'Pagamento de fatura' }),
      tx({ name: 'Estorno', date: '2026-10-11', amount: 40 }),
    ], [card, checking], today);
    expect(charges.map(c => c.name)).toEqual(['Restaurante']);
    expect(charges[0]).toMatchObject({ amount: 80, payments: 1 });
  });
  it('parcelas sem "n/N" no nome (mesmo nome e valor, com data futura) viram uma compra só', () => {
    const charges = debtorCharges([
      tx({ id: 'b1', name: 'OFICINA', date: '2026-09-29', amount: -34.25 }),
      tx({ id: 'b2', name: 'OFICINA', date: '2026-10-21', amount: -34.25 }),
      tx({ id: 'b3', name: 'OFICINA', date: '2026-11-21', amount: -34.25 }),
      tx({ id: 'b4', name: 'OFICINA', date: '2026-12-21', amount: -34.25 }),
      tx({ id: 'o1', name: 'OFICINA', date: '2026-10-10', amount: -200 }),
    ], [card], '2026-10-22');
    expect(charges).toEqual([
      expect.objectContaining({ name: 'OFICINA', amount: 200, payments: 1 }),
      expect.objectContaining({ name: 'OFICINA · 4x', amount: 34.25, payments: 3, date: '2026-09-29' }),
    ]);
  });

  it('a primeira parcela com outro nome entra na mesma compra', () => {
    const charges = debtorCharges([
      tx({ id: 'm1', name: 'MERCADOLIVRE*MERCADOLIVRE', date: '2026-10-12', amount: -38.73 }),
      tx({ id: 'm2', name: 'MERCADOLIVRE*MERC', date: '2026-11-09', amount: -38.73 }),
      tx({ id: 'm3', name: 'MERCADOLIVRE*MERC', date: '2026-12-09', amount: -38.73 }),
    ], [card], '2026-10-22');
    expect(charges).toEqual([expect.objectContaining({ name: 'MERCADOLIVRE*MERCADOLIVRE · 3x', payments: 3 })]);
  });

  it('a parcela sem "n/N" de uma compra que tem "n/N" não aparece de novo', () => {
    const charges = debtorCharges([
      tx({ id: 'f1', name: '99 FOOD 5/6', date: '2026-10-23', amount: -18.68 }),
      tx({ id: 'f2', name: '99 FOOD 6/6', date: '2026-11-21', amount: -18.68 }),
      tx({ id: 'f3', name: '99 FOOD', date: '2026-09-21', amount: -18.68 }),
      tx({ id: 'f4', name: '99Food', date: '2026-10-17', amount: -125.9 }),
    ], [card], '2026-10-22');
    expect(charges.map(c => c.name)).toEqual(['99Food', '99 FOOD · 6x']);
  });
});

describe('devedor com pagamentos contados', () => {
  it('a projeção para depois do último pagamento', () => {
    const inflows = upcomingRecurringInflows([debtor({ remainingPayments: 2 })], '2027-06');
    expect(inflows.map(o => o.date)).toEqual(['2026-11-10', '2026-12-10']);
  });

  it('sem limite (null) segue todo mês; quem pagou tudo (0) sai das receitas', () => {
    expect(upcomingRecurringInflows([debtor({ remainingPayments: null })], '2027-02')).toHaveLength(4);
    expect(recurringIncomes([debtor({ remainingPayments: 0 })])).toEqual([]);
  });
});

describe('pendingPixPayment — PIX que pode ser o pagamento do devedor', () => {
  const pix = (overrides: Partial<Transaction>): Transaction =>
    ({ id: 'pix', name: 'PIX MARIA', category: 'Transferências', date: '2026-11-08', amount: 150, accountId: 'cc', paymentType: 'debit', ...overrides });
  const find = (txs: Transaction[], rec = debtor()) => pendingPixPayment(rec, txs, [card, checking], [rec])?.id;

  it('mesmo valor perto do vencimento; o mais perto ganha', () => {
    expect(find([pix({ id: 'a', date: '2026-11-03' }), pix({ id: 'b', date: '2026-11-12' })])).toBe('b');
  });

  it('perto da receita prevista já lançada também conta', () => {
    const posted = { id: 'posted', name: 'Maria', category: 'Receita', date: '2026-10-10', amount: 150, accountId: 'cc' };
    expect(find([posted, pix({ id: 'late', date: '2026-10-14' })])).toBe('late');
  });

  it('não: outro valor, longe, já confirmado, transferência própria, cartão, lançamento da recorrência, devedor finalizado', () => {
    expect(find([
      pix({ id: '1', amount: 151 }),
      pix({ id: '2', date: '2026-12-01' }),
      pix({ id: '3', recurringId: 'outro' }),
      pix({ id: '4', category: 'Transferência entre contas' }),
      pix({ id: '5', accountId: 'card' }),
      pix({ id: '6', name: 'Maria' }),
    ])).toBeUndefined();
    expect(find([pix({})], debtor({ active: false }))).toBeUndefined();
  });
});
