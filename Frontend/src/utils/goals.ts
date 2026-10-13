import type { Account, Goal, Investment } from '../types';
import { todayISO } from './debts';

// FIN-051 — regras de exibição de uma meta financeira. Separadas do componente (como
// `computeBudgetProgress` em FIN-044) para poderem ser testadas sem renderizar React.
export interface GoalProgress {
  /** Percentual acumulado da meta (0-100+; pode passar de 100 quando o usuário supera o alvo). */
  percentage: number;
  /** Quanto ainda falta para atingir o alvo; nunca negativo. */
  remaining: number;
  /** Meta atingida (valor acumulado alcançou ou passou o alvo). */
  isAchieved: boolean;
  /** Prazo estourado sem a meta ter sido atingida. */
  isOverdue: boolean;
}

/**
 * Calcula o progresso de uma meta. `targetAmount` é validado como > 0 no backend
 * (`goalSchema` em server.js), mas o guard contra zero fica aqui também porque dados
 * antigos ou uma resposta inesperada da API não devem produzir `Infinity`/`NaN` na tela.
 *
 * A comparação de prazo usa string ISO (YYYY-MM-DD) contra `todayISO()`, nunca
 * `new Date(targetDate)` — mesma razão de fuso horário explicada em `isDebtOverdue`.
 */
export function computeGoalProgress(
  goal: Pick<Goal, 'currentAmount' | 'targetAmount' | 'targetDate'>
): GoalProgress {
  const isAchieved = goal.targetAmount > 0
    ? goal.currentAmount >= goal.targetAmount
    // Meta sem alvo positivo (dado inesperado) é tratada como já atingida, em vez de
    // dividir por zero e exibir um progresso sem sentido.
    : true;

  return {
    percentage: goal.targetAmount > 0 ? (goal.currentAmount / goal.targetAmount) * 100 : 100,
    remaining: Math.max(0, goal.targetAmount - goal.currentAmount),
    isAchieved,
    isOverdue: !isAchieved && goal.targetDate < todayISO(),
  };
}

/**
 * Quanto uma meta ligada a uma conta ou a um investimento (FIN-113) tem acumulado agora — o saldo
 * da conta ou o valor atual da posição, já em real (`accounts`/`investments` convertidos pelo
 * chamador, mesma moeda de `computeNetWorth`). `null` quando a meta não está ligada, ou quando
 * está ligada a algo que sumiu (conta/investimento excluído): quem chama sabe, então, que não há
 * nada a sincronizar — a meta já voltou ao modo manual, com o último valor gravado.
 */
export function linkedGoalAmount(
  goal: Pick<Goal, 'accountId' | 'investmentId'>,
  accounts: Pick<Account, 'id' | 'balance'>[],
  investments: Pick<Investment, 'id' | 'currentValue'>[]
): number | null {
  if (goal.accountId) return accounts.find(a => a.id === goal.accountId)?.balance ?? null;
  if (goal.investmentId) return investments.find(i => i.id === goal.investmentId)?.currentValue ?? null;
  return null;
}
