// FIN-057 (parte 1/2) — aritmética de datas ISO compartilhada por dívidas (FIN-034) e
// recorrências (FIN-053). Os testes de `advanceMonth` vieram de `debts.test.ts`, junto com
// a função, quando ela foi extraída para `dates.ts`.
import { describe, it, expect } from 'vitest';
import {
  isLeapYear, daysInMonth, advanceMonth, advanceDays, advanceYear, advanceOccurrence,
  shiftMonth, dateInMonth, monthsDescending, formatMonthLabel, formatRelativeTime,
} from './dates';

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

describe('shiftMonth', () => {
  it('avança e recua dentro do mesmo ano', () => {
    expect(shiftMonth('2026-09', 1)).toBe('2026-10');
    expect(shiftMonth('2026-09', -1)).toBe('2026-08');
  });
  it('vira o ano nos dois sentidos', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
  it('desloca vários anos de uma vez', () => {
    expect(shiftMonth('2026-05', -13)).toBe('2025-04');
    expect(shiftMonth('2026-05', 24)).toBe('2028-05');
  });
  it('devolve a entrada quando ela não é um mês válido', () => {
    expect(shiftMonth('2026-13', 1)).toBe('2026-13');
    expect(shiftMonth('2026-09-10', 1)).toBe('2026-09-10');
  });
});

describe('dateInMonth', () => {
  it('monta a data do dia dentro do mês', () => {
    expect(dateInMonth('2026-09', 9)).toBe('2026-09-09');
  });
  it('ajusta o dia 31 ao último dia de um mês de 30', () => {
    expect(dateInMonth('2026-09', 31)).toBe('2026-09-30');
  });
  it('respeita fevereiro, bissexto ou não', () => {
    expect(dateInMonth('2028-02', 31)).toBe('2028-02-29');
    expect(dateInMonth('2026-02', 31)).toBe('2026-02-28');
  });
});

describe('monthsDescending', () => {
  it('extrai os meses sem repetir, do mais recente para o mais antigo', () => {
    expect(monthsDescending(['2026-07-15', '2026-09-02', '2026-07-28'])).toEqual(['2026-09', '2026-07']);
  });
  it('inclui o mês pedido mesmo sem nenhuma data nele', () => {
    expect(monthsDescending([], '2026-09')).toEqual(['2026-09']);
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

describe('formatRelativeTime', () => {
  const now = new Date('2026-09-10T15:00:00Z');
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it('menos de um minuto é "agora"', () => {
    expect(formatRelativeTime(ago(30_000), now)).toBe('agora');
  });
  it('minutos', () => {
    expect(formatRelativeTime(ago(5 * MINUTE), now)).toBe('há 5 min');
  });
  it('horas', () => {
    expect(formatRelativeTime(ago(3 * HOUR), now)).toBe('há 3 h');
  });
  it('entre 24 e 48 h é "ontem"', () => {
    expect(formatRelativeTime(ago(30 * HOUR), now)).toBe('ontem');
  });
  it('dias', () => {
    expect(formatRelativeTime(ago(4 * DAY), now)).toBe('há 4 dias');
  });
  it('a partir de uma semana mostra a data', () => {
    expect(formatRelativeTime(ago(10 * DAY), now)).toBe(new Date(now.getTime() - 10 * DAY).toLocaleDateString('pt-BR'));
  });
  it('instante no futuro (relógio adiantado) vira "agora", não tempo negativo', () => {
    expect(formatRelativeTime(new Date(now.getTime() + 5 * MINUTE).toISOString(), now)).toBe('agora');
  });
  it('timestamp inválido devolve texto vazio', () => {
    expect(formatRelativeTime('xyz', now)).toBe('');
  });
});
