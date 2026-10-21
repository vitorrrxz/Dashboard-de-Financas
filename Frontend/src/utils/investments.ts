import type { Account, Investment, InvestmentType } from '../types';

// FIN-072/FIN-073 — regras da carteira de investimentos. Funções puras, fora do componente,
// no mesmo espírito de `goals.ts` e `budget.ts`: testáveis sem renderizar React. Todos os
// valores em REAIS.

/** Rótulos dos tipos de investimento, na ordem em que aparecem no formulário. */
export const INVESTMENT_TYPE_LABELS: Record<InvestmentType, string> = {
  fixed_income: 'Renda Fixa',
  stocks: 'Ações',
  funds: 'Fundos',
  crypto: 'Criptomoedas',
  other: 'Outros',
};

/**
 * `true` se o valor é um dos tipos conhecidos. Usa `hasOwnProperty`, e não `in`: `in` também
 * aceita chaves herdadas do protótipo, e um tipo "constructor" vindo da API passaria como
 * válido e renderizaria uma função no lugar do rótulo.
 */
export function isInvestmentType(value: string): value is InvestmentType {
  return Object.prototype.hasOwnProperty.call(INVESTMENT_TYPE_LABELS, value);
}

/** Rótulo de um tipo vindo da API; um tipo desconhecido vira "Outros" em vez de quebrar a tela. */
export function investmentTypeLabel(type: string): string {
  return isInvestmentType(type) ? INVESTMENT_TYPE_LABELS[type] : INVESTMENT_TYPE_LABELS.other;
}

/** Arredonda para centavos — somas de floats acumulam ruído (mesma razão de FIN-015). */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Lê o texto de um campo de valor do formulário (`<input type="number">` entrega ponto
 * decimal). Devolve `null` para vazio, texto inválido ou negativo — quem chama decide o que o
 * vazio significa (no valor atual, "igual ao aplicado"). O formulário guarda o texto, e não o
 * número, justamente para distinguir campo vazio de um 0 digitado.
 */
export function parseAmountInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return round2(value);
}

/** Percentual com sinal ("+2,50%", "−12,30%") para rentabilidade. */
export function formatSignedPercent(value: number): string {
  const abs = Math.abs(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? '−' : '+'}${abs}%`;
}

export interface InvestmentReturn {
  /** Valor atual − valor aplicado (negativo = prejuízo). */
  gain: number;
  /** Rentabilidade em %, ou `null` quando não há valor aplicado que sirva de base. */
  percentage: number | null;
}

/**
 * Resultado de uma posição, ou de um conjunto delas. Sem valor aplicado — um bônus em ações,
 * uma cripto recebida de presente — não existe rentabilidade percentual: dividir por zero
 * daria `Infinity`. Nesse caso o percentual é `null` e a tela mostra só o ganho em reais.
 */
export function computeReturn(amountInvested: number, currentValue: number): InvestmentReturn {
  const gain = round2(currentValue - amountInvested);
  return {
    gain,
    // Multiplica antes de dividir: `0.3 * 100` dá 30.000000000000004, `30 / 1` dá 30.
    percentage: amountInvested > 0 ? (gain * 100) / amountInvested : null,
  };
}

/** Uma fatia da alocação da carteira por tipo de investimento. */
export interface AllocationSlice {
  type: InvestmentType;
  /** Valor atual somado das posições desse tipo. */
  value: number;
  /** Participação no valor atual da carteira, em % (0 quando a carteira inteira vale 0). */
  share: number;
  /** Quantas posições desse tipo. */
  count: number;
}

export interface PortfolioSummary {
  invested: number;
  current: number;
  gain: number;
  percentage: number | null;
  /** Alocação por tipo, da maior fatia para a menor; tipos sem posição não aparecem. */
  allocation: AllocationSlice[];
}

/** Totais da carteira (aplicado, valor atual, resultado) e a alocação por tipo. */
export function summarizePortfolio(
  investments: Pick<Investment, 'type' | 'amountInvested' | 'currentValue'>[]
): PortfolioSummary {
  let invested = 0;
  let current = 0;
  const byType = new Map<InvestmentType, { value: number; count: number }>();

  for (const inv of investments) {
    invested += inv.amountInvested;
    current += inv.currentValue;
    // Um tipo fora da lista (dado antigo, resposta inesperada) é agrupado em "Outros", do
    // mesmo jeito que o rótulo exibido — senão a fatia apareceria sem nome.
    const type: InvestmentType = isInvestmentType(inv.type) ? inv.type : 'other';
    const slice = byType.get(type) ?? { value: 0, count: 0 };
    slice.value += inv.currentValue;
    slice.count += 1;
    byType.set(type, slice);
  }

  invested = round2(invested);
  current = round2(current);

  const allocation = [...byType.entries()]
    .map(([type, { value, count }]) => ({
      type,
      value: round2(value),
      count,
      share: current > 0 ? (value * 100) / current : 0,
    }))
    // Empate de valor desempata pelo tipo, para a ordem não depender da ordem de entrada.
    .sort((a, b) => b.value - a.value || a.type.localeCompare(b.type));

  return { invested, current, ...computeReturn(invested, current), allocation };
}

/** Quanto o usuário tem em investimentos, e de onde vem cada parte (FIN-073). */
export interface InvestmentHoldings {
  /** Posições da carteira + contas de investimento sem posições. */
  total: number;
  /** Soma do valor atual das posições da carteira. */
  positions: number;
  /** Soma do saldo das contas de investimento que não têm posições vinculadas. */
  accountBalances: number;
  /** Quantas posições entraram no total. */
  positionCount: number;
  /** Quantas contas de investimento entraram pelo saldo. */
  accountCount: number;
  /** Contas de investimento cujo saldo foi substituído pelas posições vinculadas a elas. */
  coveredAccountIds: string[];
}

/**
 * Quanto o usuário tem investido, sem contar a mesma aplicação duas vezes (FIN-073).
 *
 * Há duas fontes: o saldo das contas do tipo `investment` (digitado à mão, FIN-018) e as
 * posições da carteira (FIN-070). Uma conta de investimento com posições vinculadas passa a
 * ser **representada pelas posições**: elas detalham o que há dentro da conta, e somar também
 * o saldo da conta contaria o mesmo dinheiro duas vezes. Uma conta de investimento sem
 * posições continua entrando pelo saldo — quem ainda não montou a carteira não vê o
 * patrimônio encolher.
 *
 * Posições sem conta, ou vinculadas a uma conta que não é de investimento, entram pelo valor
 * atual: a aplicação atrelada a uma conta corrente não faz parte do saldo dela. O mesmo vale
 * para um vínculo com uma conta que não está na lista (excluída, ou fora do filtro).
 */
export function computeInvestmentHoldings(
  accounts: Pick<Account, 'id' | 'type' | 'balance'>[],
  investments: Pick<Investment, 'accountId' | 'currentValue'>[]
): InvestmentHoldings {
  const investmentAccounts = accounts.filter(a => a.type === 'investment');
  const investmentAccountIds = new Set(investmentAccounts.map(a => a.id));

  const covered = new Set<string>();
  for (const inv of investments) {
    if (inv.accountId && investmentAccountIds.has(inv.accountId)) covered.add(inv.accountId);
  }

  const uncoveredAccounts = investmentAccounts.filter(a => !covered.has(a.id));
  const positions = investments.reduce((sum, inv) => sum + inv.currentValue, 0);
  const accountBalances = uncoveredAccounts.reduce((sum, a) => sum + a.balance, 0);

  return {
    total: round2(positions + accountBalances),
    positions: round2(positions),
    accountBalances: round2(accountBalances),
    positionCount: investments.length,
    accountCount: uncoveredAccounts.length,
    coveredAccountIds: [...covered],
  };
}

/** Legenda curta da origem do total ("3 ativo(s) · 1 conta(s)"), para o card do Dashboard. */
export function describeHoldings(holdings: Pick<InvestmentHoldings, 'positionCount' | 'accountCount'>): string {
  const parts: string[] = [];
  if (holdings.positionCount > 0) parts.push(`${holdings.positionCount} ativo(s)`);
  if (holdings.accountCount > 0) parts.push(`${holdings.accountCount} conta(s)`);
  return parts.join(' · ') || 'nenhum ativo';
}
