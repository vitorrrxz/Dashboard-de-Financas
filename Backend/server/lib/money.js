import { z } from 'zod';

// Os totais do app são exibidos em real; contas e posições em outra moeda entram neles
// convertidas pela cotação do dia (FIN-075).
export const BASE_CURRENCY = 'BRL';
export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

// FIN-074 — símbolo de cada moeda aceita pelo app. Espelha `CURRENCY_SYMBOLS` de
// src/utils/currency.ts, pelo mesmo motivo das outras duplicações deste arquivo: backend e
// frontend não compartilham módulos. As chaves são a lista de moedas aceitas nos cadastros.
export const CURRENCY_SYMBOLS = { BRL: 'R$', USD: 'US$', EUR: '€', GBP: '£', CHF: 'CHF', CAD: 'C$', AUD: 'A$' };

// FIN-074 — moedas aceitas nos cadastros: as chaves de `CURRENCY_SYMBOLS`, as mesmas do
// frontend (`SUPPORTED_CURRENCIES` em src/utils/currency.ts — um teste garante que as listas
// não divergem) e todas cotadas pelo provedor de câmbio (FIN-075).
export const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_SYMBOLS);
export const currencyField = z.enum(SUPPORTED_CURRENCIES, {
  message: `Moeda deve ser uma de: ${SUPPORTED_CURRENCIES.join(', ')}.`,
}).optional();

// Converte reais (decimal) para centavos (inteiro) — ver FIN-015. A API da Pluggy retorna
// valores em reais; o schema local agora armazena tudo em centavos. Duplicado de
// `src/utils/money.ts` porque backend (Node puro) e frontend (bundle Vite) não
// compartilham módulos TS neste projeto.
export function toCents(reais) {
  return Math.round(reais * 100);
}

/**
 * "US$ 1.234,56" a partir de centavos — mesmo formato de `formatMoney` no frontend. Moeda
 * fora da lista aparece pelo código ISO.
 */
export function formatCents(cents, currency = 'BRL') {
  const symbol = Object.prototype.hasOwnProperty.call(CURRENCY_SYMBOLS, currency) ? CURRENCY_SYMBOLS[currency] : currency;
  const value = (Math.abs(cents) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbol} ${value}`;
}

/** "R$ 1.234,56" a partir de centavos — mesmo formato de `formatBRL` no frontend. */
export function formatCentsBRL(cents) {
  return formatCents(cents, 'BRL');
}

/** "15/09" a partir de uma data ISO, sem passar por `Date` (imune a fuso). */
export function formatDayMonth(dateString) {
  const [, month, day] = dateString.split('-');
  return `${day}/${month}`;
}
