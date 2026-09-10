// FIN-057 (parte 1/2) — aritmética de datas ISO compartilhada por dívidas (FIN-034) e
// recorrências (FIN-053). Os testes de `advanceMonth` vieram de `debts.test.ts`, junto com
// a função, quando ela foi extraída para `dates.ts`.
import { describe, it, expect } from 'vitest';
import { isLeapYear, daysInMonth, advanceMonth, advanceDays, advanceYear, advanceOccurrence } from './dates';

describe('isLeapYear', () => {
  it('ano divisível por 4 é bissexto', () => {
    expect(isLeapYear(2024)).toBe(true);
  });
  it('ano não divisível por 4 não é bissexto', () => {
    expect(isLeapYear(2026)).toBe(false);
  });
  it('século não divisível por 400 NÃO é bissexto (regra gregoriana)', () => {
    expect(isLeapYear(1900)).toBe(false);
  });
  it('século divisível por 400 é bissexto', () => {
    expect(isLeapYear(2000)).toBe(true);
  });
});

describe('daysInMonth', () => {
  it('fevereiro tem 28 dias em ano comum e 29 em bissexto', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
  });
  it('meses de 30 e 31 dias', () => {
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe('advanceMonth', () => {
  it('avança um mês normalmente', () => {
    expect(advanceMonth('2026-03-15')).toBe('2026-04-15');
  });
  it('vira o ano ao passar de dezembro para janeiro', () => {
    expect(advanceMonth('2026-12-20')).toBe('2027-01-20');
  });
  it('dia 31/jan clampa para o último dia de fevereiro em ano não-bissexto', () => {
    expect(advanceMonth('2026-01-31')).toBe('2026-02-28');
  });
  it('dia 31/jan clampa para 29/fev em ano bissexto', () => {
    expect(advanceMonth('2024-01-31')).toBe('2024-02-29');
  });
  it('data em formato inválido é devolvida intacta, sem lançar', () => {
    expect(advanceMonth('não-é-data')).toBe('não-é-data');
  });
});

describe('advanceDays', () => {
  it('avança 7 dias dentro do mesmo mês', () => {
    expect(advanceDays('2026-03-01', 7)).toBe('2026-03-08');
  });
  it('vira o mês corretamente', () => {
    expect(advanceDays('2026-01-28', 7)).toBe('2026-02-04');
  });
  it('vira o ano corretamente', () => {
    expect(advanceDays('2026-12-30', 7)).toBe('2027-01-06');
  });
  it('atravessa 29/fev em ano bissexto', () => {
    expect(advanceDays('2024-02-26', 7)).toBe('2024-03-04');
  });
  it('atravessa fevereiro em ano comum (sem 29/fev)', () => {
    expect(advanceDays('2026-02-26', 7)).toBe('2026-03-05');
  });
});

describe('advanceYear', () => {
  it('avança um ano mantendo mês e dia', () => {
    expect(advanceYear('2026-06-15')).toBe('2027-06-15');
  });
  it('29/fev de ano bissexto clampa para 28/fev no ano seguinte (data que não existiria)', () => {
    expect(advanceYear('2024-02-29')).toBe('2025-02-28');
  });
  it('28/fev não é afetado ao cair em ano bissexto', () => {
    expect(advanceYear('2023-02-28')).toBe('2024-02-28');
  });
});

describe('advanceOccurrence', () => {
  it('weekly avança 7 dias', () => {
    expect(advanceOccurrence('2026-03-01', 'weekly')).toBe('2026-03-08');
  });
  it('monthly avança um mês', () => {
    expect(advanceOccurrence('2026-03-01', 'monthly')).toBe('2026-04-01');
  });
  it('yearly avança um ano', () => {
    expect(advanceOccurrence('2026-03-01', 'yearly')).toBe('2027-03-01');
  });
  it('sempre retorna data estritamente maior que a entrada (garante avanço do laço de processamento)', () => {
    // Datas de borda que já quebraram implementações ingênuas: 31 do mês, 29/fev e fim de ano.
    for (const date of ['2026-01-31', '2024-02-29', '2026-12-31', '2026-02-28']) {
      for (const freq of ['weekly', 'monthly', 'yearly'] as const) {
        expect(advanceOccurrence(date, freq) > date).toBe(true);
      }
    }
  });
});
