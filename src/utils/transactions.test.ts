// FIN-093 — filtro mensal e totais da aba Transações.
import { describe, it, expect } from 'vitest';
import {
  ALL_MONTHS, availableMonths, filterByKind, filterByMonthAndSearch,
  formatMonthLabel, summarizeTransactions,
} from './transactions';
import type { Transaction } from '../types';

function tx(overrides: Partial<Transaction>): Transaction {
  return { id: Math.random().toString(), name: 'Tx', category: 'Outros', date: '2026-09-01', amount: 0, ...overrides };
}

describe('availableMonths', () => {
  it('lista os meses presentes do mais recente para o mais antigo, sem repetir', () => {
    const meses = availableMonths([
      tx({ date: '2026-07-15' }), tx({ date: '2026-09-02' }),
      tx({ date: '2026-07-28' }), tx({ date: '2026-08-01' }),
    ]);
    expect(meses).toEqual(['2026-09', '2026-08', '2026-07']);
  });

  it('ordena corretamente na virada de ano', () => {
    const meses = availableMonths([
      tx({ date: '2026-02-10' }), tx({ date: '2025-12-31' }), tx({ date: '2026-01-05' }),
    ]);
    expect(meses).toEqual(['2026-02', '2026-01', '2025-12']);
  });

  it('inclui o mês corrente mesmo sem nenhuma transação nele', () => {
    expect(availableMonths([tx({ date: '2026-07-15' })], '2026-09')).toEqual(['2026-09', '2026-07']);
  });

  it('não duplica o mês corrente quando ele já tem transações', () => {
    expect(availableMonths([tx({ date: '2026-09-15' })], '2026-09')).toEqual(['2026-09']);
  });

  it('devolve só o mês corrente quando não há transações', () => {
    expect(availableMonths([], '2026-09')).toEqual(['2026-09']);
  });
});

describe('formatMonthLabel', () => {
  it('formata o mês em português com a inicial maiúscula', () => {
    expect(formatMonthLabel('2026-09')).toBe('Setembro/2026');
  });

  it('não desloca o mês por causa do fuso (janeiro não vira dezembro do ano anterior)', () => {
    // `new Date('2026-01')` seria lido como UTC e, em UTC-3, cairia em 31/12/2025.
    expect(formatMonthLabel('2026-01')).toBe('Janeiro/2026');
  });

  it('devolve a entrada quando ela não é um mês válido', () => {
    expect(formatMonthLabel('nao-e-mes')).toBe('nao-e-mes');
  });
});

describe('filterByMonthAndSearch', () => {
  const dados = [
    tx({ date: '2026-09-05', name: 'Salário', category: 'Receita', amount: 5000 }),
    tx({ date: '2026-09-10', name: 'Mercado', category: 'Alimentação', amount: -300 }),
    tx({ date: '2026-10-01', name: 'Mercado', category: 'Alimentação', amount: -150 }),
  ];

  it('restringe ao mês de referência', () => {
    expect(filterByMonthAndSearch(dados, '2026-09', '')).toHaveLength(2);
  });

  it('devolve todos os meses com o valor sentinela', () => {
    expect(filterByMonthAndSearch(dados, ALL_MONTHS, '')).toHaveLength(3);
  });

  it('combina mês e busca — a busca sozinha traria as duas do "Mercado"', () => {
    const r = filterByMonthAndSearch(dados, '2026-09', 'mercado');
    expect(r).toHaveLength(1);
    expect(r[0].date).toBe('2026-09-10');
  });

  it('busca também na categoria, sem diferenciar maiúsculas', () => {
    expect(filterByMonthAndSearch(dados, ALL_MONTHS, 'ALIMENT')).toHaveLength(2);
  });

  it('ignora espaços em volta da busca', () => {
    expect(filterByMonthAndSearch(dados, ALL_MONTHS, '  salário  ')).toHaveLength(1);
  });

  it('não recorta o mês seguinte por prefixo parecido', () => {
    // '2026-1' não pode capturar '2026-10'; o filtro compara o mês inteiro.
    expect(filterByMonthAndSearch(dados, '2026-10', '')).toHaveLength(1);
  });
});

describe('filterByKind', () => {
  const dados = [
    tx({ amount: 5000 }), tx({ amount: -300 }), tx({ amount: 0 }),
  ];

  it('isola receitas', () => {
    expect(filterByKind(dados, 'income').map(t => t.amount)).toEqual([5000]);
  });

  it('isola despesas', () => {
    expect(filterByKind(dados, 'expense').map(t => t.amount)).toEqual([-300]);
  });

  it('devolve tudo em "all", inclusive o valor zero', () => {
    expect(filterByKind(dados, 'all')).toHaveLength(3);
  });
});

describe('summarizeTransactions', () => {
  it('soma receitas, despesas e saldo do recorte', () => {
    const r = summarizeTransactions([
      tx({ amount: 5000 }), tx({ amount: 1200 }), tx({ amount: -300 }), tx({ amount: -700 }),
    ]);
    expect(r).toEqual({ income: 6200, expense: 1000, balance: 5200, count: 4 });
  });

  it('reporta a despesa em módulo, não negativa', () => {
    expect(summarizeTransactions([tx({ amount: -450.75 })]).expense).toBe(450.75);
  });

  it('devolve saldo negativo quando as despesas superam as receitas', () => {
    expect(summarizeTransactions([tx({ amount: 100 }), tx({ amount: -400 })]).balance).toBe(-300);
  });

  it('conta a transação de valor zero sem somá-la a nenhum dos lados', () => {
    expect(summarizeTransactions([tx({ amount: 0 })])).toEqual({ income: 0, expense: 0, balance: 0, count: 1 });
  });

  it('devolve zeros para um recorte vazio', () => {
    expect(summarizeTransactions([])).toEqual({ income: 0, expense: 0, balance: 0, count: 0 });
  });
});
