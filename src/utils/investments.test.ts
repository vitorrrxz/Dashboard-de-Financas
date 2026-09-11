// FIN-072/FIN-073 — regras da carteira de investimentos.
import { describe, it, expect } from 'vitest';
import {
  computeInvestmentHoldings, computeReturn, describeHoldings, formatSignedPercent, investmentTypeLabel,
  parseAmountInput, summarizePortfolio,
} from './investments';
import type { Account, Investment } from '../types';

function acc(overrides: Partial<Account>): Account {
  return { id: Math.random().toString(), name: 'Conta', bank: 'Banco', type: 'checking', balance: 0, color: '#fff', ...overrides };
}
function inv(overrides: Partial<Investment>): Investment {
  return {
    id: Math.random().toString(), name: 'Posição', type: 'fixed_income',
    amountInvested: 0, currentValue: 0,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('computeReturn', () => {
  it('ganho em reais e em percentual sobre o valor aplicado', () => {
    expect(computeReturn(1000, 1150)).toEqual({ gain: 150, percentage: 15 });
  });

  it('prejuízo sai negativo', () => {
    expect(computeReturn(2000, 1500)).toEqual({ gain: -500, percentage: -25 });
  });

  it('sem valor aplicado não há percentual (nada de Infinity)', () => {
    expect(computeReturn(0, 300)).toEqual({ gain: 300, percentage: null });
  });

  it('arredonda o ganho para centavos', () => {
    // 0,3 − 0,1 em ponto flutuante dá 0,19999999999999998.
    expect(computeReturn(0.1, 0.3).gain).toBe(0.2);
  });
});

describe('summarizePortfolio', () => {
  it('soma aplicado e valor atual e calcula o resultado da carteira', () => {
    const s = summarizePortfolio([
      inv({ type: 'fixed_income', amountInvested: 5000, currentValue: 5500 }),
      inv({ type: 'stocks', amountInvested: 3000, currentValue: 2700 }),
    ]);
    expect(s).toMatchObject({ invested: 8000, current: 8200, gain: 200, percentage: 2.5 });
  });

  it('alocação por tipo, da maior fatia para a menor, com participação sobre o valor atual', () => {
    const s = summarizePortfolio([
      inv({ type: 'stocks', currentValue: 2000 }),
      inv({ type: 'fixed_income', currentValue: 6000 }),
      inv({ type: 'stocks', currentValue: 1000 }),
      inv({ type: 'crypto', currentValue: 1000 }),
    ]);
    expect(s.allocation.map(a => a.type)).toEqual(['fixed_income', 'stocks', 'crypto']);
    expect(s.allocation[0]).toMatchObject({ value: 6000, share: 60, count: 1 });
    expect(s.allocation[1]).toMatchObject({ value: 3000, share: 30, count: 2 });
    expect(s.allocation[2]).toMatchObject({ value: 1000, share: 10, count: 1 });
  });

  it('empate de valor desempata pelo tipo, independentemente da ordem de entrada', () => {
    const a = summarizePortfolio([inv({ type: 'stocks', currentValue: 500 }), inv({ type: 'crypto', currentValue: 500 })]);
    const b = summarizePortfolio([inv({ type: 'crypto', currentValue: 500 }), inv({ type: 'stocks', currentValue: 500 })]);
    expect(a.allocation.map(x => x.type)).toEqual(['crypto', 'stocks']);
    expect(b.allocation.map(x => x.type)).toEqual(['crypto', 'stocks']);
  });

  it('tipo desconhecido vindo da API entra em "Outros", o mesmo rótulo exibido', () => {
    const s = summarizePortfolio([
      inv({ type: 'bonds' as Investment['type'], currentValue: 100 }),
      inv({ type: 'constructor' as Investment['type'], currentValue: 25 }),
      inv({ type: 'other', currentValue: 50 }),
    ]);
    expect(s.allocation).toHaveLength(1);
    expect(s.allocation[0]).toMatchObject({ type: 'other', value: 175, count: 3 });
  });

  it('carteira vazia: tudo zero, sem percentual e sem fatias', () => {
    expect(summarizePortfolio([])).toEqual({ invested: 0, current: 0, gain: 0, percentage: null, allocation: [] });
  });

  it('carteira que vale zero não produz NaN na participação', () => {
    const s = summarizePortfolio([inv({ type: 'stocks', amountInvested: 100, currentValue: 0 })]);
    expect(s.allocation[0].share).toBe(0);
    expect(s.percentage).toBe(-100);
  });
});

describe('investmentTypeLabel', () => {
  it('traduz os tipos conhecidos', () => {
    expect(investmentTypeLabel('fixed_income')).toBe('Renda Fixa');
    expect(investmentTypeLabel('crypto')).toBe('Criptomoedas');
  });

  it('tipo desconhecido, inclusive chave herdada do protótipo, vira "Outros"', () => {
    expect(investmentTypeLabel('bonds')).toBe('Outros');
    // Com `in` no lugar de hasOwnProperty, "constructor" passaria e devolveria uma função.
    expect(investmentTypeLabel('constructor')).toBe('Outros');
    expect(investmentTypeLabel('toString')).toBe('Outros');
  });
});

describe('parseAmountInput', () => {
  it('lê o texto do campo como valor em reais, arredondado a centavos', () => {
    expect(parseAmountInput('1500')).toBe(1500);
    expect(parseAmountInput(' 2500.5 ')).toBe(2500.5);
    expect(parseAmountInput('10.999')).toBe(11);
  });

  it('um 0 digitado é zero — diferente do campo vazio', () => {
    expect(parseAmountInput('0')).toBe(0);
    expect(parseAmountInput('')).toBeNull();
    expect(parseAmountInput('   ')).toBeNull();
  });

  it('rejeita negativo, texto que não é número e infinito', () => {
    expect(parseAmountInput('-1')).toBeNull();
    expect(parseAmountInput('abc')).toBeNull();
    expect(parseAmountInput('Infinity')).toBeNull();
  });
});

describe('formatSignedPercent', () => {
  it('sempre com sinal e duas casas', () => {
    expect(formatSignedPercent(2.5)).toBe('+2,50%');
    expect(formatSignedPercent(-12.3)).toBe('−12,30%');
    expect(formatSignedPercent(0)).toBe('+0,00%');
  });
});

describe('computeInvestmentHoldings (FIN-073)', () => {
  it('conta de investimento sem posições entra pelo saldo, como antes da carteira existir', () => {
    const h = computeInvestmentHoldings([acc({ id: 'xp', type: 'investment', balance: 10000 })], []);
    expect(h).toMatchObject({ total: 10000, positions: 0, accountBalances: 10000, positionCount: 0, accountCount: 1 });
    expect(h.coveredAccountIds).toEqual([]);
  });

  it('conta de investimento com posições é representada por elas — o saldo não soma em dobro', () => {
    const h = computeInvestmentHoldings(
      [acc({ id: 'xp', type: 'investment', balance: 10000 })],
      [inv({ accountId: 'xp', currentValue: 4000 }), inv({ accountId: 'xp', currentValue: 5000 })]
    );
    // Somar saldo + posições daria 19.000; o total correto é o das posições.
    expect(h.total).toBe(9000);
    expect(h.accountBalances).toBe(0);
    expect(h.accountCount).toBe(0);
    expect(h.coveredAccountIds).toEqual(['xp']);
  });

  it('posições sem conta somam junto com as contas de investimento sem posições', () => {
    const h = computeInvestmentHoldings(
      [acc({ id: 'xp', type: 'investment', balance: 10000 })],
      [inv({ currentValue: 2500 })]
    );
    expect(h).toMatchObject({ total: 12500, positions: 2500, accountBalances: 10000, positionCount: 1, accountCount: 1 });
  });

  it('só as contas com posição são substituídas; as demais continuam pelo saldo', () => {
    const h = computeInvestmentHoldings(
      [acc({ id: 'xp', type: 'investment', balance: 10000 }), acc({ id: 'rico', type: 'investment', balance: 3000 })],
      [inv({ accountId: 'xp', currentValue: 9500 })]
    );
    expect(h.total).toBe(12500);
    expect(h.coveredAccountIds).toEqual(['xp']);
    expect(h.accountCount).toBe(1);
  });

  it('posição vinculada a uma conta corrente entra pelo valor e não cobre a conta', () => {
    const h = computeInvestmentHoldings(
      [acc({ id: 'nubank', type: 'checking', balance: 800 })],
      [inv({ accountId: 'nubank', currentValue: 1200 })]
    );
    // A conta corrente não é investimento: o saldo dela é dinheiro líquido, contado fora daqui.
    expect(h.total).toBe(1200);
    expect(h.coveredAccountIds).toEqual([]);
  });

  it('vínculo com conta que não está na lista (excluída) não esconde saldo nenhum', () => {
    const h = computeInvestmentHoldings(
      [acc({ id: 'xp', type: 'investment', balance: 10000 })],
      [inv({ accountId: 'conta-excluida', currentValue: 700 })]
    );
    expect(h.total).toBe(10700);
    expect(h.coveredAccountIds).toEqual([]);
  });

  it('cartão de crédito nunca entra, nem com saldo preenchido', () => {
    expect(computeInvestmentHoldings([acc({ type: 'credit', balance: 5000 })], []).total).toBe(0);
  });

  it('arredonda a soma das posições para centavos', () => {
    const h = computeInvestmentHoldings([], [inv({ currentValue: 0.1 }), inv({ currentValue: 0.2 })]);
    expect(h.total).toBe(0.3);
  });

  it('sem contas nem posições, tudo é zero', () => {
    expect(computeInvestmentHoldings([], [])).toEqual({
      total: 0, positions: 0, accountBalances: 0, positionCount: 0, accountCount: 0, coveredAccountIds: [],
    });
  });
});

describe('describeHoldings', () => {
  it('descreve de onde vem o total', () => {
    expect(describeHoldings({ positionCount: 3, accountCount: 1 })).toBe('3 ativo(s) · 1 conta(s)');
    expect(describeHoldings({ positionCount: 2, accountCount: 0 })).toBe('2 ativo(s)');
    expect(describeHoldings({ positionCount: 0, accountCount: 1 })).toBe('1 conta(s)');
    expect(describeHoldings({ positionCount: 0, accountCount: 0 })).toBe('nenhum ativo');
  });
});
