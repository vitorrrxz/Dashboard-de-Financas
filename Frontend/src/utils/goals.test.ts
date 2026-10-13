// FIN-052 (parte 1/2) — regras de progresso de meta financeira.
// FIN-113 (parte 2/2) — quanto uma meta ligada a conta/investimento tem acumulado.
import { describe, it, expect } from 'vitest';
import { computeGoalProgress, linkedGoalAmount } from './goals';
import { todayISO } from './debts';

describe('computeGoalProgress', () => {
  it('calcula percentual e valor restante de uma meta em andamento', () => {
    const p = computeGoalProgress({ currentAmount: 2500, targetAmount: 10000, targetDate: '2099-01-01' });
    expect(p.percentage).toBe(25);
    expect(p.remaining).toBe(7500);
    expect(p.isAchieved).toBe(false);
    expect(p.isOverdue).toBe(false);
  });

  it('meta atingida exatamente no alvo conta como atingida (limite, não só acima)', () => {
    const p = computeGoalProgress({ currentAmount: 10000, targetAmount: 10000, targetDate: '2099-01-01' });
    expect(p.isAchieved).toBe(true);
    expect(p.percentage).toBe(100);
    expect(p.remaining).toBe(0);
  });

  it('valor acumulado acima do alvo passa de 100% mas nunca deixa "restante" negativo', () => {
    const p = computeGoalProgress({ currentAmount: 12000, targetAmount: 10000, targetDate: '2099-01-01' });
    expect(p.percentage).toBe(120);
    expect(p.remaining).toBe(0);
    expect(p.isAchieved).toBe(true);
  });

  it('prazo vencido sem atingir o alvo marca a meta como atrasada', () => {
    const p = computeGoalProgress({ currentAmount: 100, targetAmount: 10000, targetDate: '2020-01-01' });
    expect(p.isOverdue).toBe(true);
  });

  it('meta atingida nunca fica atrasada, mesmo com prazo no passado', () => {
    const p = computeGoalProgress({ currentAmount: 10000, targetAmount: 10000, targetDate: '2020-01-01' });
    expect(p.isOverdue).toBe(false);
  });

  it('meta com prazo hoje NÃO está atrasada (vence hoje, não antes)', () => {
    const p = computeGoalProgress({ currentAmount: 0, targetAmount: 10000, targetDate: todayISO() });
    expect(p.isOverdue).toBe(false);
  });

  it('alvo zerado (dado inesperado) não gera divisão por zero nem NaN na tela', () => {
    const p = computeGoalProgress({ currentAmount: 0, targetAmount: 0, targetDate: '2099-01-01' });
    expect(Number.isFinite(p.percentage)).toBe(true);
    expect(p.percentage).toBe(100);
    expect(p.isAchieved).toBe(true);
  });
});

describe('linkedGoalAmount', () => {
  const accounts = [{ id: 'acc-1', balance: 5000 }];
  const investments = [{ id: 'inv-1', currentValue: 8000 }];

  it('meta ligada a uma conta usa o saldo dela', () => {
    expect(linkedGoalAmount({ accountId: 'acc-1', investmentId: undefined }, accounts, investments)).toBe(5000);
  });

  it('meta ligada a um investimento usa o valor atual dele', () => {
    expect(linkedGoalAmount({ accountId: undefined, investmentId: 'inv-1' }, accounts, investments)).toBe(8000);
  });

  it('meta não ligada devolve null', () => {
    expect(linkedGoalAmount({ accountId: undefined, investmentId: undefined }, accounts, investments)).toBeNull();
  });

  it('conta ligada não encontrada (excluída) devolve null', () => {
    expect(linkedGoalAmount({ accountId: 'sumiu', investmentId: undefined }, accounts, investments)).toBeNull();
  });

  it('investimento ligado não encontrado (excluído) devolve null', () => {
    expect(linkedGoalAmount({ accountId: undefined, investmentId: 'sumiu' }, accounts, investments)).toBeNull();
  });

  it('com os dois presentes (não deveria acontecer), a conta tem prioridade', () => {
    expect(linkedGoalAmount({ accountId: 'acc-1', investmentId: 'inv-1' }, accounts, investments)).toBe(5000);
  });
});
