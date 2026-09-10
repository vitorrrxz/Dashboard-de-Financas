import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { Wallet, TrendingUp, CreditCard, TrendingDown, Scale } from 'lucide-react';
import type { Account, Debt, Transaction } from '../types';
import { computeMonthlyComparison, computeYearlyComparison, computeNetWorth } from '../utils/reports';

interface ReportsViewProps {
  transactions: Transaction[];
  accounts: Account[];
  debts: Debt[];
}

/** Formata um valor em reais para exibição (mesmo formato usado no Dashboard). */
function fmt(value: number): string {
  return `R$ ${Math.abs(value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

/** Card de composição do patrimônio: rótulo, valor e se entra somando ou subtraindo. */
function CompositionCard({ title, amount, icon, negative }: {
  title: string; amount: number; icon: React.ReactNode; negative?: boolean;
}) {
  return (
    <div className="glass-card rounded-2xl p-5">
      <div className="flex justify-between items-start mb-3">
        <div className="p-2 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
          {icon}
        </div>
      </div>
      <p className="text-xs font-medium text-textMuted mb-1">{title}</p>
      <p className={`text-xl font-bold tracking-tight ${negative ? 'text-red-400' : 'text-white'}`}>
        {negative && amount !== 0 ? '−' : ''}{fmt(amount)}
      </p>
    </div>
  );
}

/**
 * Aba "Relatórios" (FIN-062, FIN-063 e FIN-064) — patrimônio líquido e comparativos de
 * receitas × despesas por mês e por ano. Tudo derivado no cliente a partir dos dados já
 * carregados (`src/utils/reports.ts`), sem endpoint dedicado.
 */
export function ReportsView({ transactions, accounts, debts }: ReportsViewProps) {
  const [granularity, setGranularity] = useState<'monthly' | 'yearly'>('monthly');

  const netWorth = useMemo(() => computeNetWorth(accounts, debts), [accounts, debts]);
  const monthly = useMemo(() => computeMonthlyComparison(transactions, 12), [transactions]);
  const yearly = useMemo(() => computeYearlyComparison(transactions), [transactions]);

  const comparison = granularity === 'monthly' ? monthly : yearly;

  return (
    <div className="space-y-8">
      {/* ── Patrimônio líquido (FIN-064) ── */}
      <section>
        <div className="glass-card rounded-2xl p-6 mb-5">
          <div className="flex items-center gap-3 mb-2">
            <Scale size={20} style={{ color: 'var(--color-primary)' }} />
            <h3 className="text-lg font-semibold text-white">Patrimônio Líquido</h3>
          </div>
          <p className={`text-4xl font-bold tracking-tight ${netWorth.total >= 0 ? 'text-white' : 'text-red-400'}`}>
            {netWorth.total < 0 ? '−' : ''}{fmt(netWorth.total)}
          </p>
          <p className="text-xs text-textMuted mt-2">
            {fmt(netWorth.assets)} em ativos {netWorth.liabilities > 0 ? `− ${fmt(netWorth.liabilities)} em passivos` : 'sem passivos registrados'}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <CompositionCard title="Saldo em Contas" amount={netWorth.liquid}
            icon={<Wallet size={18} style={{ color: 'var(--color-primary)' }} />} />
          <CompositionCard title="Investimentos" amount={netWorth.investments}
            icon={<TrendingUp size={18} className="text-teal-400" />} />
          <CompositionCard title="Faturas em Aberto" amount={netWorth.pendingBills} negative
            icon={<CreditCard size={18} className="text-pink-400" />} />
          <CompositionCard title="Dívidas em Aberto" amount={netWorth.debts} negative
            icon={<TrendingDown size={18} className="text-amber-400" />} />
        </div>
      </section>

      {/* ── Comparativo receitas × despesas (FIN-062 / FIN-063) ── */}
      <section className="glass-card rounded-2xl p-6">
        <div className="flex justify-between items-center mb-6 gap-3 flex-wrap">
          <h3 className="text-lg font-semibold text-white">Receitas × Despesas</h3>
          <div className="flex bg-white/5 p-1 rounded-xl border border-white/5">
            <button onClick={() => setGranularity('monthly')}
              className={`px-3 py-1.5 text-[10px] uppercase font-bold rounded-lg transition-all ${granularity === 'monthly' ? 'bg-primary text-white shadow-lg' : 'text-textMuted hover:text-white'}`}>
              Mês a Mês
            </button>
            <button onClick={() => setGranularity('yearly')}
              className={`px-3 py-1.5 text-[10px] uppercase font-bold rounded-lg transition-all ${granularity === 'yearly' ? 'bg-primary text-white shadow-lg' : 'text-textMuted hover:text-white'}`}>
              Ano a Ano
            </button>
          </div>
        </div>

        {comparison.length === 0 ? (
          <p className="text-center text-textMuted py-12 text-sm">
            Nenhuma transação registrada ainda — importe um extrato para ver os comparativos.
          </p>
        ) : (
          <>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparison} margin={{ left: -10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" vertical={false} />
                  <XAxis dataKey="label" stroke="#6b7280" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                  <YAxis stroke="#6b7280" axisLine={false} tickLine={false} tick={{ fontSize: 10 }}
                    tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
                  <RechartsTooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                    contentStyle={{ backgroundColor: '#1c1c24', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 }}
                    labelStyle={{ color: '#9ca3af' }}
                    formatter={(v, name) => [fmt(Number(v)), name]} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Bar dataKey="income" name="Receitas" fill="#14b8a6" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="expense" name="Despesas" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Tabela do mesmo recorte: o gráfico dá a leitura visual, a tabela dá o número
                exato — inclusive o saldo do período, que não é uma das barras. */}
            <div className="overflow-x-auto mt-6">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-textMuted">
                    <th className="pb-3 font-semibold">{granularity === 'monthly' ? 'Mês' : 'Ano'}</th>
                    <th className="pb-3 font-semibold text-right">Receitas</th>
                    <th className="pb-3 font-semibold text-right">Despesas</th>
                    <th className="pb-3 font-semibold text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-white/5">
                  {[...comparison].reverse().map(row => (
                    <tr key={row.period} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 text-white font-medium">{row.label}</td>
                      <td className="py-3 text-right text-teal-400">{fmt(row.income)}</td>
                      <td className="py-3 text-right text-red-400">{fmt(row.expense)}</td>
                      <td className={`py-3 text-right font-bold ${row.balance >= 0 ? 'text-white' : 'text-red-400'}`}>
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
    </div>
  );
}
