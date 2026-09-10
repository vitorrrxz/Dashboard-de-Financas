import type { Account, Debt, Transaction } from '../types';
import { isDebtPaid, todayISO } from './debts';

// FIN-062/FIN-063/FIN-064 — agregações da aba Relatórios. Funções puras (sem endpoint
// novo), calculadas sobre os dados já carregados, no mesmo espírito de `useFinancialStats`
// e `projection.ts`. Todos os valores em REAIS.

/** Um período agregado (mês ou ano) com receitas, despesas e saldo. */
export interface PeriodComparison {
  /** Chave do período: `YYYY-MM` no comparativo mensal, `YYYY` no anual. */
  period: string;
  /** Rótulo para o eixo do gráfico (ex.: "out/26" ou "2026"). */
  label: string;
  income: number;
  expense: number;
  /** Receitas − despesas do período (pode ser negativo). */
  balance: number;
}

/** Arredonda para centavos — somas de floats acumulam ruído (mesma razão de FIN-015). */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Rótulo "out/26" a partir de `YYYY-MM`; o dia 15 evita que o fuso empurre para outro mês. */
function monthLabel(period: string): string {
  return new Date(period + '-15').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}

/**
 * Agrupa as transações por período (mês ou ano), somando receitas e despesas.
 * Períodos sem transação nenhuma não aparecem — o gráfico mostra o que existe, e não uma
 * régua de meses vazios.
 */
function groupByPeriod(
  transactions: Pick<Transaction, 'amount' | 'date'>[],
  keyOf: (dateISO: string) => string,
  labelOf: (period: string) => string
): PeriodComparison[] {
  const buckets: Record<string, { income: number; expense: number }> = {};

  for (const tx of transactions) {
    const period = keyOf(tx.date);
    if (!buckets[period]) buckets[period] = { income: 0, expense: 0 };
    if (tx.amount >= 0) {
      buckets[period].income += tx.amount;
    } else {
      buckets[period].expense += Math.abs(tx.amount);
    }
  }

  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, { income, expense }]) => ({
      period,
      label: labelOf(period),
      income: round2(income),
      expense: round2(expense),
      balance: round2(income - expense),
    }));
}

/**
 * Comparativo mês a mês de receitas e despesas (FIN-062), do mais antigo ao mais recente.
 * `months` limita aos N períodos mais recentes **com movimento** — um gráfico com dezenas
 * de meses fica ilegível, e o corte é feito no fim (períodos recentes) de propósito.
 */
export function computeMonthlyComparison(
  transactions: Pick<Transaction, 'amount' | 'date'>[],
  months = 12
): PeriodComparison[] {
  const all = groupByPeriod(transactions, date => date.slice(0, 7), monthLabel);
  return months > 0 ? all.slice(-months) : all;
}

/** Comparativo ano a ano (FIN-063) — mesma agregação, com granularidade anual. */
export function computeYearlyComparison(
  transactions: Pick<Transaction, 'amount' | 'date'>[]
): PeriodComparison[] {
  return groupByPeriod(transactions, date => date.slice(0, 4), period => period);
}

/** Composição do patrimônio líquido (FIN-064). */
export interface NetWorth {
  /** Saldo líquido: conta corrente, poupança e dinheiro em espécie. */
  liquid: number;
  /** Saldo das contas do tipo investimento (separado do líquido — ver FIN-018). */
  investments: number;
  /** Faturas de cartão em aberto (passivo). */
  pendingBills: number;
  /** Saldo devedor das dívidas ainda não quitadas (passivo). */
  debts: number;
  /** Total de ativos (líquido + investimentos). */
  assets: number;
  /** Total de passivos (faturas + dívidas). */
  liabilities: number;
  /** Ativos − passivos. */
  total: number;
}

/**
 * Calcula o patrimônio líquido: ativos (saldo líquido + investimentos) menos passivos
 * (faturas de cartão em aberto + saldo devedor das dívidas).
 *
 * As mesmas regras de classificação de `useFinancialStats` valem aqui: cartão de crédito
 * nunca entra como ativo (seu saldo é a fatura, um passivo) e investimento é somado à
 * parte do dinheiro líquido (ver FIN-018).
 *
 * Nota de escopo: os investimentos vêm das **contas** do tipo `investment`, que é o que o
 * app tem hoje. Quando o módulo de investimentos (FIN-070) trouxer ativos com quantidade e
 * cotação, esta parcela deve passar a somar o valor de mercado da carteira.
 */
export function computeNetWorth(
  accounts: Pick<Account, 'type' | 'balance' | 'pendingBill'>[],
  debts: Pick<Debt, 'totalAmount' | 'paidAmount' | 'paidInstallments' | 'totalInstallments'>[]
): NetWorth {
  const liquid = accounts
    .filter(a => a.type !== 'credit' && a.type !== 'investment')
    .reduce((sum, a) => sum + a.balance, 0);

  const investments = accounts
    .filter(a => a.type === 'investment')
    .reduce((sum, a) => sum + a.balance, 0);

  const pendingBills = accounts
    .filter(a => a.type === 'credit')
    .reduce((sum, a) => sum + (a.pendingBill ?? 0), 0);

  // Dívidas quitadas são ignoradas; nas demais, conta apenas o saldo devedor restante, e
  // nunca um valor negativo (um `paidAmount` maior que o total, por dado inconsistente,
  // viraria um "ativo" fantasma se não fosse limitado em 0).
  const debtsTotal = debts
    .filter(d => !isDebtPaid(d))
    .reduce((sum, d) => sum + Math.max(0, d.totalAmount - d.paidAmount), 0);

  const assets = round2(liquid + investments);
  const liabilities = round2(pendingBills + debtsTotal);

  return {
    liquid: round2(liquid),
    investments: round2(investments),
    pendingBills: round2(pendingBills),
    debts: round2(debtsTotal),
    assets,
    liabilities,
    total: round2(assets - liabilities),
  };
}

/** Linhas do relatório de transações usadas tanto no CSV quanto no PDF (FIN-060/FIN-061). */
export const TRANSACTION_REPORT_HEADERS = ['Data', 'Descrição', 'Categoria', 'Conta', 'Tipo', 'Valor (R$)'];

/** Período coberto por um conjunto de transações, para o cabeçalho do relatório. */
export function transactionsPeriod(transactions: Pick<Transaction, 'date'>[]): { from: string; to: string } {
  if (transactions.length === 0) {
    const hoje = todayISO();
    return { from: hoje, to: hoje };
  }
  const dates = transactions.map(t => t.date).sort();
  return { from: dates[0], to: dates[dates.length - 1] };
}
