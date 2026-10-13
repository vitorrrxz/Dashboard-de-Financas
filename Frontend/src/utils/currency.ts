import type { Account, Investment, RecurringTransaction, Transaction } from '../types';

// FIN-074/FIN-075/FIN-076 — moedas. Cada conta, transação e posição guarda o valor na própria
// moeda, e a tela mostra cada item assim; só os totais (Dashboard, Relatórios, orçamento,
// projeção, carteira) convertem para real, pela cotação do dia (FIN-075). Valores em unidades
// da moeda — reais, dólares —, não em centavos, como no resto da UI.

/** Moeda em que o app soma e exibe os totais. */
export const BASE_CURRENCY = 'BRL';

/** Moedas oferecidas nos formulários — as mesmas aceitas pela API (`SUPPORTED_CURRENCIES` em server.js). */
export const SUPPORTED_CURRENCIES = ['BRL', 'USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD'] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

/** Nome de cada moeda, para os seletores. */
export const CURRENCY_LABELS: Record<CurrencyCode, string> = {
  BRL: 'Real (R$)',
  USD: 'Dólar americano (US$)',
  EUR: 'Euro (€)',
  GBP: 'Libra esterlina (£)',
  CHF: 'Franco suíço (CHF)',
  CAD: 'Dólar canadense (C$)',
  AUD: 'Dólar australiano (A$)',
};

const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  BRL: 'R$', USD: 'US$', EUR: '€', GBP: '£', CHF: 'CHF', CAD: 'C$', AUD: 'A$',
};

/** `true` para as moedas da lista. Usa `hasOwnProperty`, e não `in`, para "constructor" não passar. */
export function isSupportedCurrency(code: string): code is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCY_SYMBOLS, code);
}

/** Moeda de um registro. Ausente — dado anterior a FIN-074, ou resposta antiga — é real. */
export function currencyOf(item: { currency?: string | null }): string {
  return item.currency || BASE_CURRENCY;
}

/** Símbolo da moeda ("US$"); uma moeda fora da lista aparece pelo próprio código. */
export function currencySymbol(currency: string): string {
  return isSupportedCurrency(currency) ? CURRENCY_SYMBOLS[currency] : currency;
}

/** Nome da moeda para os seletores; uma moeda fora da lista aparece pelo código. */
export function currencyLabel(currency: string): string {
  return isSupportedCurrency(currency) ? CURRENCY_LABELS[currency] : currency;
}

/**
 * Opções do seletor de moeda: as da lista e, se a moeda do registro vier de fora dela (uma conta
 * da Pluggy em outra moeda), também essa — senão o seletor mostraria uma moeda que não é a do
 * registro.
 */
export function currencyOptions(current: string): string[] {
  return isSupportedCurrency(current) ? [...SUPPORTED_CURRENCIES] : [...SUPPORTED_CURRENCIES, current];
}

/**
 * Formata um valor na moeda indicada ("US$ 1.234,56"), sempre em módulo — o mesmo contrato de
 * `formatBRL`: o sinal fica com quem exibe. Uma moeda fora da lista (vinda da Pluggy, por
 * exemplo) aparece pelo código ISO ("ARS 1.000,00").
 */
export function formatMoney(value: number, currency: string = BASE_CURRENCY): string {
  return `${currencySymbol(currency)} ${Math.abs(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Cotações para converter ao real (FIN-075): quantos reais vale 1 unidade de cada moeda. */
export interface ExchangeRates {
  /** Data de referência da cotação (YYYY-MM-DD). */
  date: string;
  rates: Record<string, number>;
  /** `true` quando o servidor não conseguiu atualizar e serviu a última cotação conhecida. */
  stale: boolean;
}

/**
 * Normaliza a resposta de `GET /api/exchange-rates`. Um corpo inesperado vira `null` (sem
 * cotação), e cada cotação inválida — zero, negativa, não numérica, código fora do padrão ISO —
 * é descartada: uma cotação 0 zeraria em silêncio tudo o que estivesse naquela moeda.
 */
export function parseExchangeRates(body: unknown): ExchangeRates | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { date, rates, stale } = body as Record<string, unknown>;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!rates || typeof rates !== 'object' || Array.isArray(rates)) return null;

  const valid: Record<string, number> = {};
  for (const [code, rate] of Object.entries(rates as Record<string, unknown>)) {
    if (/^[A-Z]{3}$/.test(code) && typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
      valid[code] = rate;
    }
  }
  return { date, rates: valid, stale: stale === true };
}

/** Quantos reais vale 1 unidade da moeda, ou `null` sem cotação. Real vale 1, sempre. */
function rateFor(currency: string, rates: ExchangeRates | null): number | null {
  if (currency === BASE_CURRENCY) return 1;
  if (!rates || !Object.prototype.hasOwnProperty.call(rates.rates, currency)) return null;
  const rate = rates.rates[currency];
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * Aplica a cotação e arredonda para centavos. A conta é feita em centavos inteiros (o valor
 * veio de centavos, FIN-015) e o meio centavo se afasta do zero nos dois sentidos: com
 * `Math.round` direto, US$ −10 viraria R$ −51,24 e US$ +10 viraria R$ 51,25 — uma despesa e o
 * estorno dela deixariam um centavo de diferença no saldo.
 */
function applyRate(amount: number, rate: number): number {
  const cents = Math.round(amount * 100);
  const converted = Math.round(Math.abs(cents) * rate);
  return (cents < 0 ? -converted : converted) / 100;
}

/**
 * Converte um valor para real. Sem cotação para a moeda, devolve `null` — quem chama deixa o
 * item fora do total, em vez de somar dólares como se fossem reais.
 */
export function convertToBase(amount: number, currency: string, rates: ExchangeRates | null): number | null {
  if (currency === BASE_CURRENCY) return amount;
  const rate = rateFor(currency, rates);
  return rate === null ? null : applyRate(amount, rate);
}

/** Uma lista convertida para real: os itens convertidos e os que ficaram de fora por falta de cotação. */
export interface InBase<T> {
  items: T[];
  missing: T[];
}

/**
 * Converte cada item de moeda estrangeira com `convert`. Itens em real passam intactos (a mesma
 * referência), então quem só usa real não paga nada por esta camada.
 */
function inBase<T>(
  list: T[],
  currencyOfItem: (item: T) => string,
  rates: ExchangeRates | null,
  convert: (item: T, rate: number) => T
): InBase<T> {
  const items: T[] = [];
  const missing: T[] = [];
  for (const item of list) {
    const currency = currencyOfItem(item);
    if (currency === BASE_CURRENCY) {
      items.push(item);
      continue;
    }
    const rate = rateFor(currency, rates);
    if (rate === null) missing.push(item);
    else items.push(convert(item, rate));
  }
  return { items, missing };
}

/** Contas em real: saldo, limite e fatura convertidos pela mesma cotação. */
export function accountsInBase(accounts: Account[], rates: ExchangeRates | null): InBase<Account> {
  return inBase(accounts, currencyOf, rates, (account, rate) => ({
    ...account,
    currency: BASE_CURRENCY,
    balance: applyRate(account.balance, rate),
    limit: account.limit != null ? applyRate(account.limit, rate) : account.limit,
    pendingBill: account.pendingBill != null ? applyRate(account.pendingBill, rate) : account.pendingBill,
  }));
}

/** Transações em real — o sinal (receita/despesa) é preservado, porque a cotação é positiva. */
export function transactionsInBase(transactions: Transaction[], rates: ExchangeRates | null): InBase<Transaction> {
  return inBase(transactions, currencyOf, rates, (tx, rate) => ({
    ...tx,
    currency: BASE_CURRENCY,
    amount: applyRate(tx.amount, rate),
  }));
}

/** Posições da carteira em real. */
export function investmentsInBase(investments: Investment[], rates: ExchangeRates | null): InBase<Investment> {
  return inBase(investments, currencyOf, rates, (inv, rate) => ({
    ...inv,
    currency: BASE_CURRENCY,
    amountInvested: applyRate(inv.amountInvested, rate),
    currentValue: applyRate(inv.currentValue, rate),
  }));
}

/**
 * Recorrências em real. Elas não têm moeda própria: lançam na moeda da conta vinculada (ou em
 * real, sem conta) — a mesma regra que o servidor aplica ao gerar as transações.
 */
export function recurringInBase(
  recurring: RecurringTransaction[],
  accounts: Account[],
  rates: ExchangeRates | null
): InBase<RecurringTransaction> {
  const currencyByAccount = new Map(accounts.map(a => [a.id, currencyOf(a)]));
  const currencyOfRecurring = (r: RecurringTransaction) =>
    (r.accountId && currencyByAccount.get(r.accountId)) || BASE_CURRENCY;
  return inBase(recurring, currencyOfRecurring, rates, (r, rate) => ({ ...r, amount: applyRate(r.amount, rate) }));
}

/** Moedas estrangeiras presentes nas listas, sem repetição e em ordem alfabética. */
export function foreignCurrencies(...groups: { currency?: string | null }[][]): string[] {
  const found = new Set<string>();
  for (const group of groups) {
    for (const item of group) {
      const currency = currencyOf(item);
      if (currency !== BASE_CURRENCY) found.add(currency);
    }
  }
  return [...found].sort();
}

/**
 * Frase que explica a conversão dos totais (FIN-076): de que cotação vieram os valores em outra
 * moeda, se ela é antiga, e o que ficou de fora por falta de cotação. `used` são as moedas
 * estrangeiras em uso; `missing`, as que ficaram sem cotação.
 */
export function describeConversion(used: string[], missing: string[], rates: ExchangeRates | null): string {
  const converted = used.filter(code => !missing.includes(code));
  const parts: string[] = [];
  if (converted.length > 0 && rates) {
    const [year, month, day] = rates.date.split('-');
    parts.push(
      `Valores em ${converted.join(', ')} convertidos para real pela cotação de ${day}/${month}/${year}` +
      (rates.stale ? ' — a última disponível, porque o serviço de câmbio não respondeu.' : '.')
    );
  }
  if (missing.length > 0) {
    parts.push(`Sem cotação para ${missing.join(', ')} no momento: o que está nessa moeda ficou fora dos totais.`);
  }
  return parts.join(' ');
}
