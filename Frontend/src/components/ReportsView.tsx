import { useMemo, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { balanceTone, formatBRL as fmt } from '../utils/money';
import { niceTicks } from '../utils/chart';
import { useChartAnimation } from '../hooks/useMediaQuery';
import type { Account, Debt, Investment, NetWorthSnapshot, Transaction } from '../types';
import { computeMonthlyComparison, computeYearlyComparison, computeNetWorth, monthLabel, type NetWorth } from '../utils/reports';
import type { ProjectionPoint } from '../utils/projection';

interface ReportsViewProps {
  transactions: Transaction[];
  accounts: Account[];
  debts: Debt[];
  /** Posições da carteira (FIN-072) — entram nos investimentos do patrimônio (FIN-073). */
  investments: Investment[];
  /** Retratos mensais do patrimônio líquido (FIN-112), do mais antigo ao mais recente. */
  netWorthHistory: NetWorthSnapshot[];
  /** Saldo projetado dos próximos meses — o mesmo do gráfico do Dashboard (`computeBalanceProjection`). */
  projection: ProjectionPoint[];
}

/** Eixo em milhares: "2 mil", "−1,5 mil". */
const axisMoney = (v: number) => (v === 0 ? '0' : `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`);

const tooltipStyle = {
  contentStyle: { backgroundColor: 'var(--tooltip-bg)', border: '1px solid var(--tooltip-border)', borderRadius: 6, fontSize: 12, padding: '6px 10px' },
  labelStyle: { color: 'var(--color-textMuted)' },
  itemStyle: { color: 'var(--color-textMain)', padding: 0 },
  cursor: { fill: 'var(--fg-4)' },
};

/**
 * De onde vem o total de investimentos (FIN-073), quando há algo a explicar: as posições da
 * carteira, o saldo das contas de investimento que ainda não têm posições, ou os dois.
 */
function investmentsDetail(netWorth: NetWorth): string | undefined {
  if (netWorth.portfolio !== 0 && netWorth.investmentAccounts !== 0) {
    return `Carteira ${fmt(netWorth.portfolio)} + contas ${fmt(netWorth.investmentAccounts)}`;
  }
  if (netWorth.portfolio !== 0) return 'Valor atual da carteira';
  if (netWorth.investmentAccounts !== 0) return 'Saldo das contas de investimento';
  return undefined;
}

/** Uma parte do patrimônio: rótulo, valor e se entra somando ou subtraindo. */
function CompositionCell({ title, amount, negative, balance, detail }: {
  title: string; amount: number; negative?: boolean; balance?: boolean; detail?: string;
}) {
  return (
    <div className="px-5 py-4">
      <p className="text-sm text-textMuted">{title}</p>
      <p className={`text-xl font-bold ${amount === 0 ? 'text-textMuted' : negative ? 'text-debt' : balance ? balanceTone(amount) : 'text-white'}`}>
        {(negative && amount !== 0) || (balance && amount < 0) ? '−' : ''}{fmt(amount)}
      </p>
      {detail && <p className="text-xs text-textMuted mt-0.5">{detail}</p>}
    </div>
  );
}

/**
 * Aba "Relatórios" (FIN-062, FIN-063 e FIN-064) — patrimônio líquido, comparativos de
 * receitas × despesas por mês e por ano e o detalhe dos próximos meses. Tudo derivado no
 * cliente a partir dos dados já carregados (`src/utils/reports.ts`), sem endpoint dedicado.
 */
export function ReportsView({ transactions, accounts, debts, investments, netWorthHistory, projection }: ReportsViewProps) {
  const chartAnimation = useChartAnimation();
  const [granularity, setGranularity] = useState<'monthly' | 'yearly'>('monthly');

  const netWorth = useMemo(() => computeNetWorth(accounts, debts, investments, transactions), [accounts, debts, investments, transactions]);
  const monthly = useMemo(() => computeMonthlyComparison(transactions, 12), [transactions]);
  const yearly = useMemo(() => computeYearlyComparison(transactions), [transactions]);
  // FIN-112 — só o rótulo do mês para o eixo do gráfico; os valores já vêm em reais (App.tsx converte).
  const netWorthChart = useMemo(
    () => netWorthHistory.map(h => ({ ...h, label: monthLabel(h.month) })),
    [netWorthHistory]
  );

  const comparison = granularity === 'monthly' ? monthly : yearly;
  const netWorthTicks = niceTicks(netWorthChart.map(h => h.total));
  const comparisonTicks = niceTicks(comparison.flatMap(c => [c.income, c.expense]));

  return (
    <div className="space-y-8">
      {/* ── Patrimônio líquido (FIN-064) ── */}
      <section>
        <div className="panel rounded-2xl">
          <div className="p-5 md:p-6">
            <h3 className="text-sm text-textMuted">Patrimônio líquido</h3>
            <p className={`text-[32px] leading-10 font-bold tracking-tight mt-1 ${balanceTone(netWorth.total)}`}>
              {netWorth.total < 0 ? '−' : ''}{fmt(netWorth.total)}
            </p>
            <p className="text-sm text-textMuted mt-1">
              {fmt(netWorth.assets)} em ativos {netWorth.liabilities > 0 ? `− ${fmt(netWorth.liabilities)} em passivos` : 'e nenhum passivo registrado'}
            </p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-white/[0.07] border-t border-white/[0.07] rounded-b-2xl overflow-hidden [&>*]:bg-card">
            <CompositionCell title="Saldo em contas" amount={netWorth.liquid} balance />
            <CompositionCell title="Investimentos" amount={netWorth.investments} detail={investmentsDetail(netWorth)} />
            <CompositionCell title="Faturas em aberto" amount={netWorth.pendingBills} negative />
            <CompositionCell title="Parcelas futuras do cartão" amount={netWorth.cardInstallments} negative />
            <CompositionCell title="Dívidas em aberto" amount={netWorth.debts} negative />
          </div>
        </div>
      </section>

      {/* ── Evolução do patrimônio (FIN-112) — só a partir do primeiro mês registrado. ── */}
      {netWorthChart.length > 0 && (
        <section className="panel rounded-2xl p-6">
          <h3 className="text-base font-medium text-white mb-4">Evolução do patrimônio</h3>

          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={netWorthChart} margin={{ top: 8, left: 0, right: 16, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={6} />
                <YAxis axisLine={false} tickLine={false} width={60} tickFormatter={axisMoney}
                  ticks={netWorthTicks} domain={[netWorthTicks[0], netWorthTicks[netWorthTicks.length - 1]]} interval={0} />
                <ReferenceLine y={0} stroke="var(--chart-axis)" strokeOpacity={0.6} />
                <RechartsTooltip {...tooltipStyle} cursor={{ stroke: 'var(--chart-grid)' }}
                  formatter={v => [`${Number(v) < 0 ? '−' : ''}${fmt(Number(v))}`, 'Patrimônio']} />
                <Line type="linear" dataKey="total" stroke="var(--color-accent)" strokeWidth={2}
                  dot={netWorthChart.length === 1} activeDot={{ r: 4 }} {...chartAnimation} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* A mesma leitura da tabela de baixo, para o valor exato de cada mês. */}
          <div className="overflow-x-auto mt-6">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--line)] text-xs text-textMuted">
                  <th className="pb-2 font-normal">Mês</th>
                  <th className="pb-2 font-normal text-right">Contas</th>
                  <th className="pb-2 font-normal text-right">Investimentos</th>
                  <th className="pb-2 font-normal text-right">Passivos</th>
                  <th className="pb-2 font-normal text-right">Patrimônio</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-white/5">
                {[...netWorthChart].reverse().map(snapshot => (
                  <tr key={snapshot.month} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 text-white">{snapshot.label}</td>
                    <td className={`py-3 text-right ${balanceTone(snapshot.liquid)}`}>
                      {snapshot.liquid < 0 ? '−' : ''}{fmt(snapshot.liquid)}
                    </td>
                    <td className="py-3 text-right text-white">{fmt(snapshot.investments)}</td>
                    <td className={`py-3 text-right ${snapshot.liabilities > 0 ? "text-debt" : "text-white"}`}>{snapshot.liabilities > 0 ? `−${fmt(snapshot.liabilities)}` : fmt(0)}</td>
                    <td className={`py-3 text-right font-medium ${balanceTone(snapshot.total)}`}>
                      {snapshot.total < 0 ? '−' : ''}{fmt(snapshot.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Comparativo receitas × despesas (FIN-062 / FIN-063) ── */}
      <section className="panel rounded-2xl p-6">
        <div className="flex justify-between items-center mb-6 gap-3 flex-wrap">
          <h3 className="text-base font-medium text-white">Receitas e despesas</h3>
          <div className="flex items-center gap-4">
            <span className="hidden sm:flex items-center gap-3 text-xs text-textMuted">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'var(--chart-ink)' }} />Receitas</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'var(--color-red-500)' }} />Despesas</span>
            </span>
            <div role="group" aria-label="Período" className="flex p-0.5 rounded-md bg-white/[0.06]">
              {([['monthly', 'Mês a mês'], ['yearly', 'Ano a ano']] as const).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={granularity === value} onClick={() => setGranularity(value)}
                  className={`h-7 px-3 text-xs rounded transition-colors ${granularity === value ? 'bg-card text-white font-medium' : 'text-textMuted hover:text-white'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {comparison.length === 0 ? (
          <p className="text-sm text-textMuted py-3 px-3 rounded-md border border-dashed border-[var(--control)]">
            Nenhuma transação registrada ainda — importe um extrato para ver os comparativos.
          </p>
        ) : (
          <>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparison} margin={{ top: 4, left: 0, right: 16, bottom: 0 }} barGap={2}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={6} />
                  <YAxis axisLine={false} tickLine={false} width={60} tickFormatter={axisMoney}
                    ticks={comparisonTicks} domain={[0, comparisonTicks[comparisonTicks.length - 1]]} interval={0} />
                  <RechartsTooltip {...tooltipStyle} formatter={(v, name) => [fmt(Number(v)), name]} />
                  <Bar dataKey="income" name="Receitas" fill="var(--chart-ink)" maxBarSize={24} {...chartAnimation} />
                  <Bar dataKey="expense" name="Despesas" fill="var(--color-red-500)" maxBarSize={24} {...chartAnimation} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Tabela do mesmo recorte: o gráfico dá a leitura visual, a tabela dá o número
                exato — inclusive o saldo do período, que não é uma das barras. */}
            <div className="overflow-x-auto mt-6">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--line)] text-xs text-textMuted">
                    <th className="pb-2 font-normal">{granularity === 'monthly' ? 'Mês' : 'Ano'}</th>
                    <th className="pb-2 font-normal text-right">Receitas</th>
                    <th className="pb-2 font-normal text-right">Despesas</th>
                    <th className="pb-2 font-normal text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-white/5">
                  {[...comparison].reverse().map(row => (
                    <tr key={row.period} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 text-white">{row.label}</td>
                      <td className="py-3 text-right text-white">{fmt(row.income)}</td>
                      <td className="py-3 text-right text-white">{fmt(row.expense)}</td>
                      <td className={`py-3 text-right font-medium ${balanceTone(row.balance)}`}>
                        {row.balance < 0 ? '−' : ''}{fmt(row.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* ── Próximos meses: o detalhe do saldo projetado do Dashboard ── */}
      <section className="panel rounded-2xl p-6">
        <h3 className="text-base font-medium text-white mb-1">Próximos meses</h3>
        <p className="text-xs text-textMuted mb-4">
          Entradas: salário, receitas extras (PLR, 13º...) e devedores. Saídas: fatura, parcelas do cartão, dívidas e despesas recorrentes.
        </p>
        {projection.every(p => p.salaryDelta === 0 && p.debtDelta === 0) ? (
          <p className="text-sm text-textMuted py-3 px-3 rounded-md border border-dashed border-[var(--control)]">
            Informe o salário no Dashboard ou cadastre dívidas para ver os próximos meses.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--line)] text-xs text-textMuted">
                  <th className="pb-2 font-normal">Mês</th>
                  <th className="pb-2 font-normal text-right">Entradas</th>
                  <th className="pb-2 font-normal text-right">Saídas</th>
                  <th className="pb-2 font-normal text-right">Sobra do mês</th>
                  <th className="pb-2 font-normal text-right">Saldo ao fim do mês</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-white/5">
                {projection.map(point => {
                  const leftover = point.salaryDelta - point.debtDelta;
                  return (
                    <tr key={point.month} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 text-white">{point.name}</td>
                      <td className="py-3 text-right text-white">{fmt(point.salaryDelta)}</td>
                      <td className={`py-3 text-right ${point.debtDelta > 0 ? 'text-debt' : 'text-white'}`}>{point.debtDelta > 0 ? '−' : ''}{fmt(point.debtDelta)}</td>
                      <td className={`py-3 text-right ${balanceTone(leftover)}`}>{leftover < 0 ? '−' : ''}{fmt(leftover)}</td>
                      <td className={`py-3 text-right font-medium ${balanceTone(point.balance)}`}>{point.balance < 0 ? '−' : ''}{fmt(point.balance)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
