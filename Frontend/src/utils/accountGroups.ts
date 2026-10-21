// Contas agrupadas por banco: a Pluggy entrega conta corrente e cartão como contas separadas, e o
// app mostra e filtra as duas juntas, pelo banco. O filtro aceita o id de uma conta ou
// `bank:<chave>` para o banco inteiro.
import type { Account } from '../types';

const BANK_PREFIX = 'bank:';

/** "Itaú", "itau " e "ITAU" são o mesmo banco. */
function bankKey(bank: string): string {
  return bank.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase() || 'sem banco';
}

export interface BankGroup {
  key: string;
  /** Valor do filtro que seleciona o banco inteiro. */
  value: string;
  bank: string;
  accounts: Account[];
}

/** Bancos na ordem da primeira conta de cada um; o nome exibido é o da primeira conta. */
export function groupByBank(accounts: Account[]): BankGroup[] {
  const groups = new Map<string, BankGroup>();
  for (const account of accounts) {
    const key = bankKey(account.bank);
    const group = groups.get(key)
      ?? { key, value: BANK_PREFIX + key, bank: account.bank.trim() || 'Sem banco', accounts: [] };
    group.accounts.push(account);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * Contas de uma seleção do filtro: uma conta, um banco inteiro, ou `null` = todas. Uma seleção
 * que não casa com mais nada (conta excluída) também vale "todas", para não esvaziar as listas.
 */
export function accountIdsOf(selection: string | null, accounts: Account[]): Set<string> | null {
  if (!selection) return null;
  const ids = selection.startsWith(BANK_PREFIX)
    ? accounts.filter(a => BANK_PREFIX + bankKey(a.bank) === selection).map(a => a.id)
    : accounts.filter(a => a.id === selection).map(a => a.id);
  return ids.length ? new Set(ids) : null;
}

/** Item (transação, dívida, posição) dentro da seleção. */
export function inAccounts(ids: Set<string> | null, accountId: string | null | undefined): boolean {
  return !ids || (!!accountId && ids.has(accountId));
}
