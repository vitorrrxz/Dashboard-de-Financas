import { describe, it, expect } from 'vitest';
import { accountIdsOf, groupByBank, inAccounts } from './accountGroups';
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
