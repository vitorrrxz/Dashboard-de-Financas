import { useMemo } from 'react';
import { isDebtOverdue, todayISO } from '../utils/debts';
import { computeInvestmentHoldings } from '../utils/investments';
import { isOwnTransfer } from '../utils/categories';
import { groupInstallmentPurchases, parseInstallment } from '../utils/installments';
import { advanceDays, dateInMonth, shiftMonth } from '../utils/dates';
import { accountIdsOf, inAccounts } from '../utils/accountGroups';
import type { Outflow } from '../utils/salary';
import type { Account, Debt, Investment, Transaction } from '../types';

// FIN-086 — lógica de cálculo financeiro extraída de dentro de `App.tsx` (onde vivia como
// um `useMemo` inline de ~70 linhas) para este módulo dedicado. Objetivo duplo: (1)
// separar regra de negócio da camada de UI; (2) tornar a lógica testável sem precisar
// renderizar componentes React — ver `computeFinancialStats` abaixo, usado diretamente
// pelos testes de FIN-034 (`useFinancialStats.test.ts`).
//
// Todos os valores de entrada/saída estão em REAIS (não centavos) — a conversão para/de
// centavos acontece só na borda com a API (ver `accountFromApi`/`txFromApi` em App.tsx).
export interface ByPaymentType { debitPix: number; credit: number; installment: number }

export interface FinancialStats {
  income: number;
  expense: number;
  importedBalance: number;
  balanceByMonth: { name: string; balance: number }[];
  dailyEvolution: { name: string; balance: number }[];
  expenseByCategory: { name: string; amount: number }[];
  monthExpense: number;
  /** Compras no cartão da fatura que vence neste mês (ciclo de fechamento; sem fechamento, o mês civil). Contam como dívida. */
  monthCardExpense: number;
  /** `monthExpense` dividido pela forma de pagamento: débito/PIX, crédito à vista, crédito parcelado. */
  monthExpenseByType: ByPaymentType;
  /** `monthCardExpense + monthDebtPayments` divididos do mesmo jeito que `monthExpenseByType`. */
  monthDebtsByType: ByPaymentType;
  realBalance: number;
  investmentBalance: number;
  pendingBills: number;
  activeDebts: number;
  /** Soma das parcelas mensais das dívidas ainda não quitadas — o que sai do salário todo mês. */
  monthDebtPayments: number;
  /** Tudo o que se deve: dívidas cadastradas + faturas pendentes + parcelas futuras do cartão. */
  totalOwed: number;
  /** Dívidas do mês com o dia em que vencem: cartão pelo vencimento da fatura, parcela pelo vencimento. */
  monthOutflows: Outflow[];
  overdueDebts: Debt[];
  filteredTxsCount: number;
}

/**
 * Período de compras (início e fim, inclusive) da fatura que vence em `month` (YYYY-MM). Vencimento
 * até o dia do fechamento = a fatura fechou no mês anterior (fecha 28, vence 5). Sem `dueDay`, a
 * fatura fecha no próprio mês.
 */
export function billPeriod(month: string, closingDay: number, dueDay?: number): { start: string; end: string } {
  const closingMonth = dueDay && dueDay <= closingDay ? shiftMonth(month, -1) : month;
  return {
    start: advanceDays(dateInMonth(shiftMonth(closingMonth, -1), closingDay), 1),
    end: dateInMonth(closingMonth, closingDay),
  };
}

// Padrão estável para `investments` ausente: um `[]` literal no parâmetro seria um array novo
// a cada render e invalidaria o `useMemo` do hook toda vez.
const NO_INVESTMENTS: Investment[] = [];

export function computeFinancialStats(
  transactions: Transaction[],
  accounts: Account[],
  debts: Debt[],
  dashboardAccountId: string | null,
  investments: Pick<Investment, 'accountId' | 'currentValue'>[] = NO_INVESTMENTS
): FinancialStats {
  // FIN-103: transferência entre contas próprias e pagamento de fatura não são receita nem despesa.
  // Seleção do filtro: uma conta ou um banco inteiro (conta corrente + cartão) — ver accountGroups.
  const ids = accountIdsOf(dashboardAccountId, accounts);
  const activeTxs = transactions.filter(t => inAccounts(ids, t.accountId)).filter(t => !isOwnTransfer(t));

  const activeAccs = accounts.filter(a => inAccounts(ids, a.id));

  const activeDebts = debts.filter(d => inAccounts(ids, d.accountId));

  // FIN-073: com uma conta selecionada, só as posições da carteira vinculadas a ela.
  const activeInvestments = investments.filter(i => inAccounts(ids, i.accountId));

  const income = activeTxs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const expense = activeTxs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const importedBalance = income - expense;

  const monthMap: Record<string, number> = {};
  activeTxs.forEach(tx => {
    const m = tx.date.slice(0, 7);
    monthMap[m] = (monthMap[m] ?? 0) + tx.amount;
  });
  const balanceByMonth = Object.entries(monthMap)
    .sort(([a], [b]) => a.localeCompare(b)).slice(-7)
    .map(([k, v]) => ({
      name: new Date(k + '-15').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
      balance: +v.toFixed(2),
    }));

  const catMap: Record<string, number> = {};
  activeTxs.filter(t => t.amount < 0).forEach(t => {
    catMap[t.category] = (catMap[t.category] ?? 0) + Math.abs(t.amount);
  });
  const expenseByCategory = Object.entries(catMap)
    .sort(([, a], [, b]) => b - a).slice(0, 6)
    .map(([name, amount]) => ({ name, amount: +amount.toFixed(2) }));

  const today = todayISO();
  const mPrefix = today.slice(0, 7);
  const monthExpense = activeTxs.filter(t => t.amount < 0 && t.date.startsWith(mPrefix)).reduce((s, t) => s + Math.abs(t.amount), 0);
  // Compra no cartão = transação de conta de crédito ou importada como crédito. Ela é dívida, e
  // entra no mês da fatura em que cai: cartão com dia de fechamento usa o ciclo da fatura que
  // vence neste mês; sem fechamento cadastrado, o mês civil.
  const periods = new Map(accounts
    .filter(a => a.type === 'credit')
    .map(a => [a.id, a.closingDay ? billPeriod(mPrefix, a.closingDay, a.dueDay) : null]));
  const isCard = (t: Transaction) => t.paymentType === 'credit' || (!!t.accountId && periods.has(t.accountId));
  const inThisBill = (t: Transaction) => {
    const period = t.accountId ? periods.get(t.accountId) : null;
    return period ? t.date >= period.start && t.date <= period.end : t.date.startsWith(mPrefix);
  };
  const expenses = activeTxs.filter(t => t.amount < 0);
  const monthCardExpense = expenses.filter(t => isCard(t) && inThisBill(t)).reduce((s, t) => s + Math.abs(t.amount), 0);
  // Mesmo recorte de `monthExpense` (mês civil), separado pela forma de pagamento. PIX no
  // crédito chega como compra no cartão, então cai em crédito à vista ou parcelado.
  const txKind = (t: Transaction): keyof ByPaymentType =>
    t.paymentType === 'pix_installment' || (isCard(t) && parseInstallment(t.name)) ? 'installment'
      : isCard(t) ? 'credit' : 'debitPix';
  const monthExpenseByType: ByPaymentType = { debitPix: 0, credit: 0, installment: 0 };
  expenses.filter(t => t.date.startsWith(mPrefix)).forEach(t => { monthExpenseByType[txKind(t)] += Math.abs(t.amount); });

  // "Saldo Real" reflete apenas dinheiro líquido disponível (corrente/poupança/dinheiro).
  // Investimentos são somados separadamente — misturá-los ao saldo líquido pode enganar
  // o usuário sobre quanto ele realmente tem disponível para gastar (ver FIN-018).
  const realBalance = activeAccs.filter(a => a.type !== 'credit' && a.type !== 'investment').reduce((s, a) => s + a.balance, 0);
  // FIN-073: posições da carteira + contas de investimento sem posições. A conta com posições
  // é representada por elas, sem contar em dobro — mesma regra do patrimônio líquido.
  const investmentBalance = computeInvestmentHoldings(activeAccs, activeInvestments).total;
  const pendingBills = activeAccs.filter(a => a.type === 'credit').reduce((s, a) => s + (a.pendingBill ?? 0), 0);
  const totalActiveDebts = activeDebts.reduce((s, d) => s + (d.totalAmount - d.paidAmount), 0);
  const monthDebtPayments = activeDebts
    .filter(d => d.paidInstallments < d.totalInstallments)
    .reduce((s, d) => s + d.monthlyPayment, 0);
  // Dívida cadastrada não tem forma de pagamento: mais de uma parcela = parcelado; parcela
  // única = crédito à vista se for de cartão, senão débito/PIX (empréstimo, boleto…).
  const monthDebtsByType: ByPaymentType = { debitPix: 0, credit: 0, installment: 0 };
  expenses.filter(t => isCard(t) && inThisBill(t)).forEach(t => { monthDebtsByType[txKind(t)] += Math.abs(t.amount); });
  activeDebts.filter(d => d.paidInstallments < d.totalInstallments).forEach(d => {
    const kind = d.totalInstallments > 1 ? 'installment' : d.category === 'Cartão de Crédito' ? 'credit' : 'debitPix';
    monthDebtsByType[kind] += d.monthlyPayment;
  });
  // Parcelas do cartão ainda não lançadas: as já lançadas estão na fatura pendente.
  const futureCardInstallments = groupInstallmentPurchases(activeTxs, today).reduce((s, p) => s + p.remainingAmount, 0);
  const totalOwed = totalActiveDebts + pendingBills + futureCardInstallments;

  // As mesmas dívidas de monthCardExpense + monthDebtPayments, com o dia de cada uma — para dividir a
  // sobra (salário − dívidas) entre os pagamentos do salário quinzenal.
  const dayOf = (iso: string) => Number(iso.slice(8, 10));
  const dueDays = new Map(accounts.map(a => [a.id, a.dueDay]));
  const monthOutflows: Outflow[] = [
    ...expenses.filter(t => isCard(t) && inThisBill(t))
      .map(t => ({ day: (t.accountId && dueDays.get(t.accountId)) || dayOf(t.date), amount: Math.abs(t.amount) })),
    ...activeDebts.filter(d => d.paidInstallments < d.totalInstallments)
      .map(d => ({ day: dayOf(d.nextDueDate), amount: d.monthlyPayment })),
  ];

  const overdueDebts = activeDebts.filter(isDebtOverdue);

  const dailyMap: Record<string, number> = {};
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const startStr = thirtyDaysAgo.toISOString().substring(0, 10);

  activeTxs.filter(t => t.date >= startStr).forEach(t => {
    dailyMap[t.date] = (dailyMap[t.date] ?? 0) + t.amount;
  });
  const dailyEvolution = Object.entries(dailyMap).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => {
    return { name: k.substring(5).replace('-', '/'), balance: v };
  });

  return {
    income, expense, importedBalance, balanceByMonth, dailyEvolution,
    expenseByCategory, monthExpense, monthExpenseByType, monthDebtsByType, monthCardExpense, realBalance, investmentBalance, pendingBills,
    activeDebts: totalActiveDebts, monthDebtPayments, totalOwed, monthOutflows, overdueDebts,
    filteredTxsCount: activeTxs.length,
  };
}

export function useFinancialStats(
  transactions: Transaction[],
  accounts: Account[],
  debts: Debt[],
  dashboardAccountId: string | null,
  investments: Investment[] = NO_INVESTMENTS
): FinancialStats {
  return useMemo(
    () => computeFinancialStats(transactions, accounts, debts, dashboardAccountId, investments),
    [transactions, accounts, debts, dashboardAccountId, investments]
  );
}
