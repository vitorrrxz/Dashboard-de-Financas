import { prisma } from './prisma.js';
import { BASE_CURRENCY } from './money.js';

/**
 * FIN-074 — moeda de cada conta do usuário entre `accountIds`, para derivar a moeda das
 * transações: uma transação fica sempre na moeda da conta vinculada (em real, sem conta). Uma
 * conta que não é do usuário não entra no mapa — e as rotas recusam o vínculo com ela antes de
 * gravar (FIN-096, `hasForeignAccount`).
 */
export async function accountCurrencies(userId, accountIds) {
  const ids = [...new Set(accountIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const accounts = await prisma.account.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true, currency: true },
  });
  return new Map(accounts.map(a => [a.id, a.currency]));
}

/** Moeda de uma transação ligada a `accountId`, a partir do mapa de `accountCurrencies`. */
export function currencyForAccount(currencies, accountId) {
  return (accountId && currencies.get(accountId)) || BASE_CURRENCY;
}

// FIN-096 — a chave estrangeira só garante que a conta existe: sem conferir a posse, um usuário
// vinculava os próprios registros à conta de outra pessoa. Mesma mensagem do vínculo de
// investimentos (`nonCreditAccountError`).
export const ACCOUNT_NOT_FOUND = 'Conta vinculada não encontrada.';

/**
 * FIN-096 — algum `accountId` informado fica fora do mapa de `accountCurrencies`, isto é, não é
 * uma conta do usuário? Vazio ou nulo é "sem conta vinculada" e passa.
 */
export function hasForeignAccount(currencies, accountIds) {
  return accountIds.some(id => id && !currencies.has(id));
}

/**
 * FIN-096 — confere o `accountId` de uma dívida ou recorrência. Devolve a mensagem de erro, ou
 * `null` quando a conta é do usuário ou não foi informada.
 */
export async function accountOwnershipError(userId, accountId) {
  if (!accountId) return null;
  const owned = await prisma.account.count({ where: { id: accountId, userId } });
  return owned > 0 ? null : ACCOUNT_NOT_FOUND;
}

/**
 * Confere um `accountId` opcional que precisa existir, ser do próprio usuário e não ser cartão de
 * crédito — usado tanto por investimentos (FIN-071) quanto por metas ligadas a conta (FIN-113). A
 * chave estrangeira só garante que a conta existe; sem esta checagem, o id de uma conta de outro
 * usuário seria aceito e o registro ficaria vinculado a ela. `notCreditMessage` é de quem chama,
 * porque a concordância de gênero muda ("um investimento"/"uma meta").
 * Devolve a mensagem de erro, ou `null` quando o vínculo é válido ou não foi informado.
 */
export async function nonCreditAccountError(userId, accountId, notCreditMessage) {
  if (!accountId) return null;
  const account = await prisma.account.findFirst({ where: { id: accountId, userId }, select: { type: true } });
  if (!account) return ACCOUNT_NOT_FOUND;
  if (account.type === 'credit') return notCreditMessage;
  return null;
}
