import { describe, it, expect } from 'vitest';
import { accountIdsOf, bankGroupOf, groupByBank, inAccounts, primaryAccountOf } from './accountGroups';
import type { Account } from '../types';

function acc(id: string, bank: string, type: Account['type'] = 'checking'): Account {
  return { id, name: id, bank, type, balance: 0, color: '#fff' };
}

const accounts = [acc('cc', 'Itaú'), acc('nu', 'Nubank'), acc('card', 'itau ', 'credit')];

describe('groupByBank', () => {
  it('junta conta e cartão do mesmo banco, ignorando acento e maiúsculas', () => {
    expect(groupByBank(accounts).map(g => [g.bank, g.accounts.map(a => a.id)])).toEqual([
      ['Itaú', ['cc', 'card']],
      ['Nubank', ['nu']],
    ]);
  });
});

describe('primaryAccountOf / bankGroupOf', () => {
  it('o banco é representado pela conta corrente, mesmo listada depois do cartão', () => {
    const groups = groupByBank([acc('card', 'Itaú', 'credit'), acc('cc', 'itau')]);
    expect(primaryAccountOf(groups[0]).id).toBe('cc');
  });
  it('sem conta corrente, outra que não seja cartão; só cartão, o cartão', () => {
    expect(primaryAccountOf(groupByBank([acc('card', 'XP', 'credit'), acc('inv', 'XP', 'investment')])[0]).id).toBe('inv');
    expect(primaryAccountOf(groupByBank([acc('card', 'C6', 'credit')])[0]).id).toBe('card');
  });
  it('acha o banco do cartão; sem conta, nenhum', () => {
    const groups = groupByBank(accounts);
    expect(bankGroupOf(groups, 'card')?.bank).toBe('Itaú');
    expect(bankGroupOf(groups, undefined)).toBeUndefined();
    expect(bankGroupOf(groups, 'excluida')).toBeUndefined();
  });
});

describe('accountIdsOf', () => {
  it('banco inteiro, conta única, todas', () => {
    const itau = groupByBank(accounts)[0].value;
    expect(accountIdsOf(itau, accounts)).toEqual(new Set(['cc', 'card']));
    expect(accountIdsOf('nu', accounts)).toEqual(new Set(['nu']));
    expect(accountIdsOf(null, accounts)).toBeNull();
  });
  it('seleção que sumiu vale todas', () => {
    expect(accountIdsOf('excluida', accounts)).toBeNull();
  });
  it('inAccounts: item sem conta só entra em "todas"', () => {
    const ids = new Set(['cc']);
    expect(inAccounts(ids, 'cc')).toBe(true);
    expect(inAccounts(ids, undefined)).toBe(false);
    expect(inAccounts(null, undefined)).toBe(true);
  });
});
