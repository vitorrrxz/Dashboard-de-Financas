// FIN-074/FIN-075/FIN-076 — moedas: formatação, cotações e conversão dos totais para real.
import { describe, it, expect } from 'vitest';
import {
  accountsInBase, convertToBase, currencyLabel, currencyOf, currencyOptions, currencySymbol, describeConversion,
  foreignCurrencies, formatMoney, investmentsInBase, isSupportedCurrency, parseExchangeRates, recurringInBase,
  transactionsInBase, SUPPORTED_CURRENCIES, type ExchangeRates,
} from './currency';
import { formatBRL } from './money';
import type { Account, Investment, RecurringTransaction, Transaction } from '../types';

const RATES: ExchangeRates = { date: '2026-09-10', rates: { USD: 5.1245, EUR: 5.95 }, stale: false };

function acc(overrides: Partial<Account>): Account {
  return { id: Math.random().toString(), name: 'Conta', bank: 'Banco', type: 'checking', balance: 0, color: '#fff', ...overrides };
}
function tx(overrides: Partial<Transaction>): Transaction {
  return { id: Math.random().toString(), name: 'Tx', category: 'Outros', date: '2026-09-01', amount: 0, ...overrides };
}
function inv(overrides: Partial<Investment>): Investment {
  return {
    id: Math.random().toString(), name: 'Posição', type: 'stocks', amountInvested: 0, currentValue: 0,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', ...overrides,
  };
}
function rec(overrides: Partial<RecurringTransaction>): RecurringTransaction {
  return {
    id: Math.random().toString(), name: 'Assinatura', category: 'Outros', amount: -10, frequency: 'monthly',
    nextOccurrence: '2026-10-01', active: true, createdAt: '2026-09-01T00:00:00.000Z', ...overrides,
  };
}

describe('formatMoney', () => {
  it('em real, é idêntico ao formatBRL de sempre', () => {
    expect(formatMoney(1234.5)).toBe(formatBRL(1234.5));
    expect(formatMoney(1234.5, 'BRL')).toBe('R$ 1.234,50');
  });

  it('usa o símbolo da moeda e o formato numérico brasileiro', () => {
    expect(formatMoney(1234.56, 'USD')).toBe('US$ 1.234,56');
    expect(formatMoney(10, 'EUR')).toBe('€ 10,00');
  });

  it('valor sempre em módulo — o sinal fica com quem exibe', () => {
    expect(formatMoney(-80, 'USD')).toBe('US$ 80,00');
  });

  it('moeda fora da lista aparece pelo código, sem quebrar', () => {
    expect(formatMoney(1000, 'ARS')).toBe('ARS 1.000,00');
    expect(formatMoney(1, 'constructor')).toBe('constructor 1,00');
  });
});

describe('isSupportedCurrency / currencyOf / rótulos do seletor', () => {
  it('reconhece só as moedas da lista, sem aceitar chaves do protótipo', () => {
    expect(isSupportedCurrency('USD')).toBe(true);
    expect(isSupportedCurrency('ARS')).toBe(false);
    expect(isSupportedCurrency('toString')).toBe(false);
  });

  it('registro sem moeda (anterior a FIN-074) é real', () => {
    expect(currencyOf({})).toBe('BRL');
    expect(currencyOf({ currency: null })).toBe('BRL');
    expect(currencyOf({ currency: '' })).toBe('BRL');
    expect(currencyOf({ currency: 'USD' })).toBe('USD');
  });

  it('símbolo e nome da moeda, com o código para moeda fora da lista', () => {
    expect(currencySymbol('GBP')).toBe('£');
    expect(currencySymbol('ARS')).toBe('ARS');
    expect(currencyLabel('USD')).toBe('Dólar americano (US$)');
    expect(currencyLabel('ARS')).toBe('ARS');
  });

  it('o seletor oferece a lista e inclui a moeda atual quando ela vem de fora', () => {
    expect(currencyOptions('USD')).toEqual([...SUPPORTED_CURRENCIES]);
    expect(currencyOptions('ARS')).toEqual([...SUPPORTED_CURRENCIES, 'ARS']);
  });
});

describe('parseExchangeRates', () => {
  it('aceita a resposta da API', () => {
    expect(parseExchangeRates({ base: 'BRL', date: '2026-09-10', rates: { USD: 5.12 }, stale: true }))
      .toEqual({ date: '2026-09-10', rates: { USD: 5.12 }, stale: true });
  });

  it('descarta, uma a uma, cotações que zerariam ou inverteriam valores', () => {
    const r = parseExchangeRates({ date: '2026-09-10', rates: { USD: 5.12, EUR: 0, GBP: -1, CHF: '6', usd: 5, AUD: null } });
    expect(r?.rates).toEqual({ USD: 5.12 });
    expect(r?.stale).toBe(false);
  });

  it('corpo inesperado vira "sem cotação", em vez de quebrar a tela', () => {
    expect(parseExchangeRates(null)).toBeNull();
    expect(parseExchangeRates('erro')).toBeNull();
    expect(parseExchangeRates([])).toBeNull();
    expect(parseExchangeRates({ date: '10/09/2026', rates: {} })).toBeNull();
    expect(parseExchangeRates({ date: '2026-09-10', rates: [5.12] })).toBeNull();
    expect(parseExchangeRates({ date: '2026-09-10' })).toBeNull();
  });
});

describe('convertToBase', () => {
  it('real não precisa de cotação', () => {
    expect(convertToBase(150.5, 'BRL', null)).toBe(150.5);
  });

  it('converte pela cotação e arredonda para centavos', () => {
    expect(convertToBase(100, 'USD', RATES)).toBe(512.45);
    expect(convertToBase(-19.99, 'USD', RATES)).toBe(-102.44); // −102,438… → −102,44
  });

  it('despesa e estorno do mesmo valor convertem para o mesmo módulo (meio centavo simétrico)', () => {
    // 10 × 5,1245 = 51,245: com Math.round direto, a despesa daria −51,24 e o estorno +51,25.
    expect(convertToBase(-10, 'USD', RATES)).toBe(-51.25);
    expect(convertToBase(10, 'USD', RATES)).toBe(51.25);
  });

  it('zero continua zero, sem virar −0', () => {
    expect(Object.is(convertToBase(-0, 'USD', RATES), -0)).toBe(false);
  });

  it('sem cotação para a moeda devolve null — nunca soma dólar como real', () => {
    expect(convertToBase(100, 'GBP', RATES)).toBeNull();
    expect(convertToBase(100, 'USD', null)).toBeNull();
    expect(convertToBase(100, 'constructor', RATES)).toBeNull();
  });
});

describe('conversão das listas', () => {
  it('contas em real passam intactas; em dólar, saldo, limite e fatura são convertidos', () => {
    const real = acc({ balance: 1000 });
    const usd = acc({ currency: 'USD', type: 'credit', balance: 0, limit: 1000, pendingBill: 200 });
    const r = accountsInBase([real, usd], RATES);
    expect(r.items[0]).toBe(real); // mesma referência
    expect(r.items[1]).toMatchObject({ currency: 'BRL', balance: 0, limit: 5124.5, pendingBill: 1024.9 });
    expect(r.missing).toEqual([]);
  });

  it('conta sem fatura continua sem fatura depois de convertida (nada de NaN)', () => {
    const r = accountsInBase([acc({ currency: 'USD', balance: 10, pendingBill: undefined })], RATES);
    expect(r.items[0].pendingBill).toBeUndefined();
  });

  it('itens sem cotação ficam de fora dos itens e vão para missing', () => {
    const gbp = acc({ currency: 'GBP', balance: 500 });
    const r = accountsInBase([acc({ balance: 1 }), gbp], RATES);
    expect(r.items).toHaveLength(1);
    expect(r.missing).toEqual([gbp]);
  });

  it('transações mantêm o sinal: despesa em dólar continua despesa em real', () => {
    const r = transactionsInBase([tx({ currency: 'USD', amount: -10 }), tx({ amount: 50 })], RATES);
    expect(r.items.map(t => t.amount)).toEqual([-51.25, 50]);
    expect(r.items[0].currency).toBe('BRL');
  });

  it('posições da carteira convertem aplicado e valor atual', () => {
    const r = investmentsInBase([inv({ currency: 'EUR', amountInvested: 100, currentValue: 110 })], RATES);
    expect(r.items[0]).toMatchObject({ amountInvested: 595, currentValue: 654.5, currency: 'BRL' });
  });

  it('recorrências usam a moeda da conta vinculada; sem conta (ou conta desconhecida), real', () => {
    const usdAccount = acc({ id: 'wise', currency: 'USD' });
    const r = recurringInBase(
      [rec({ accountId: 'wise', amount: -10 }), rec({ amount: -30 }), rec({ accountId: 'sumiu', amount: -5 })],
      [usdAccount],
      RATES
    );
    expect(r.items.map(x => x.amount)).toEqual([-51.25, -30, -5]);
  });

  it('recorrência numa conta em moeda sem cotação fica de fora', () => {
    const r = recurringInBase([rec({ accountId: 'uk', amount: -10 })], [acc({ id: 'uk', currency: 'GBP' })], RATES);
    expect(r.items).toEqual([]);
    expect(r.missing).toHaveLength(1);
  });
});

describe('foreignCurrencies', () => {
  it('lista as moedas estrangeiras em uso, sem repetir e em ordem', () => {
    expect(foreignCurrencies(
      [acc({ currency: 'USD' }), acc({})],
      [tx({ currency: 'EUR' }), tx({ currency: 'USD' })],
      [inv({ currency: 'BRL' })]
    )).toEqual(['EUR', 'USD']);
  });

  it('quem só usa real não precisa de cotação nenhuma', () => {
    expect(foreignCurrencies([acc({})], [tx({})])).toEqual([]);
  });
});

describe('describeConversion', () => {
  it('diz de que cotação vieram os valores convertidos', () => {
    expect(describeConversion(['EUR', 'USD'], [], RATES))
      .toBe('Valores em EUR, USD convertidos para real pela cotação de 10/09/2026.');
  });

  it('avisa quando a cotação é a última disponível', () => {
    expect(describeConversion(['USD'], [], { ...RATES, stale: true }))
      .toBe('Valores em USD convertidos para real pela cotação de 10/09/2026 — a última disponível, porque o serviço de câmbio não respondeu.');
  });

  it('diz o que ficou fora dos totais por falta de cotação', () => {
    expect(describeConversion(['GBP'], ['GBP'], null))
      .toBe('Sem cotação para GBP no momento: o que está nessa moeda ficou fora dos totais.');
  });

  it('com parte convertida e parte sem cotação, explica as duas coisas', () => {
    expect(describeConversion(['GBP', 'USD'], ['GBP'], RATES))
      .toBe('Valores em USD convertidos para real pela cotação de 10/09/2026. Sem cotação para GBP no momento: o que está nessa moeda ficou fora dos totais.');
  });
});
