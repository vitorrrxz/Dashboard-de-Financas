import { describe, it, expect } from 'vitest';
import { biweeklyLeftovers, extrasInMonth, payDays, salaryPerMonth } from './salary';
import type { ExtraIncome, Salary } from '../types';

const salary: Salary = { amount: 1000, secondAmount: 1000, frequency: 'biweekly', payDay: 5, extras: [] };

describe('salário quinzenal', () => {
  it('soma os dois pagamentos no mês', () => {
    expect(salaryPerMonth(salary)).toBe(2000);
    expect(salaryPerMonth({ ...salary, frequency: 'monthly' })).toBe(1000);
  });

  it('cada pagamento tem o próprio valor; o 2º não conta no mensal', () => {
    const uneven: Salary = { ...salary, amount: 1200, secondAmount: 800 };
    expect(salaryPerMonth(uneven)).toBe(2000);
    expect(salaryPerMonth({ ...uneven, frequency: 'monthly' })).toBe(1200);
    const [first, second] = biweeklyLeftovers(uneven, [{ day: 10, amount: 100 }, { day: 25, amount: 300 }], 31);
    expect(first.leftover).toBe(1100);
    expect(second.leftover).toBe(500);
  });

  it('o 2º pagamento é 15 dias depois, sem passar do fim do mês', () => {
    expect(payDays(salary, 31)).toEqual([5, 20]);
    expect(payDays({ ...salary, payDay: 15 }, 28)).toEqual([15, 28]);
  });

  it('cada quinzena desconta o que sai até o pagamento seguinte; somadas dão o mês', () => {
    const outflows = [
      { day: 5, amount: 100 },  // dia do 1º pagamento: 1ª quinzena
      { day: 19, amount: 50 },  // véspera do 2º: 1ª quinzena
      { day: 20, amount: 300 }, // dia do 2º: 2ª quinzena
      { day: 2, amount: 25 },   // antes do 1º pagamento: ainda é a 2ª quinzena
    ];
    const [first, second] = biweeklyLeftovers(salary, outflows, 31);
    expect(first).toEqual({ day: 5, pay: 1000, leftover: 850 });
    expect(second).toEqual({ day: 20, pay: 1000, leftover: 675 });
    expect(first.leftover + second.leftover).toBe(2000 - 475);
  });

  it('o que os devedores pagam entra na quinzena do dia em que cai', () => {
    const [first, second] = biweeklyLeftovers(salary, [{ day: 10, amount: 100 }], 31, [], [{ day: 12, amount: 300 }, { day: 2, amount: 50 }]);
    expect(first).toEqual({ day: 5, pay: 1300, leftover: 1200 });
    expect(second).toEqual({ day: 20, pay: 1050, leftover: 1050 });
  });
});

describe('receitas extras', () => {
  const plr: ExtraIncome = { name: 'PLR', amount: 400, month: '2026-10', half: 2, yearly: false };
  const thirteenth: ExtraIncome = { name: '13º', amount: 1000, month: '2026-11', half: 1, yearly: true };
  const withExtras: Salary = { ...salary, extras: [plr, thirteenth] };

  it('a única vale só no mês dela; a anual repete no mesmo mês dos anos seguintes, nunca antes', () => {
    expect(extrasInMonth(withExtras, '2026-10')).toEqual([plr]);
    expect(extrasInMonth(withExtras, '2027-10')).toEqual([]);
    expect(extrasInMonth(withExtras, '2026-11')).toEqual([thirteenth]);
    expect(extrasInMonth(withExtras, '2027-11')).toEqual([thirteenth]);
    expect(extrasInMonth(withExtras, '2025-11')).toEqual([]);
  });

  it('cada uma entra só na quinzena escolhida', () => {
    const [first, second] = biweeklyLeftovers(salary, [], 31, [plr, thirteenth]);
    expect(first.leftover).toBe(2000);
    expect(second.leftover).toBe(1400);
  });
});
