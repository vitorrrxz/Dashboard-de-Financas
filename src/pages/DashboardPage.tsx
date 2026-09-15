import {
  Wallet, Upload, ArrowUpRight, ArrowDownRight, CreditCard, AlertCircle, TrendingDown, TrendingUp,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';
import { describeConversion, type ExchangeRates } from '../utils/currency';
import { describeHoldings, type InvestmentHoldings } from '../utils/investments';
import { CATEGORY_COLORS } from '../utils/categories';
import type { BudgetProgress } from '../utils/budget';
import type { ProjectionPoint } from '../utils/projection';
import type { FinancialStats } from '../hooks/useFinancialStats';
import type { Account, Debt, RecurringTransaction, Transaction } from '../types';
import type { Tab } from '../App';

function fmt(v: number) {
  return `R$ ${Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

function SummaryCard({ title, amount, icon, badge, isPositive, onClick }: { title: string; amount: string; icon: React.ReactNode; badge?: string; isPositive: boolean; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={`glass-card rounded-2xl p-6 transition-all ${onClick ? 'cursor-pointer hover:bg-white/5 hover:-translate-y-1' : ''}`}>
      <div className="flex justify-between items-start mb-4">
        <div className="p-2.5 rounded-xl" style={{ backgroundColor:'var(--fg-3)', border:'1px solid var(--fg-5)' }}>
          {icon}
        </div>
        {badge && <span className="text-[10px] uppercase tracking-wider font-bold text-textMuted bg-white/5 px-2.5 py-1 rounded-full border border-white/5">{badge}</span>}
      </div>
      <p className="text-sm font-medium text-textMuted mb-1">{title}</p>
      <h3 className={`text-2xl font-bold tracking-tight ${isPositive ? 'text-white' : 'text-white'}`}>
        {!isPositive && amount !== 'R$ 0,00' ? '-' : ''}{amount}
      </h3>
    </div>
  );
}

interface DashboardPageProps {
  accounts: Account[];
  dashboardAccountId: string | null;
  onChangeDashboardAccount: (id: string | null) => void;
  stats: FinancialStats;
  overBudget: BudgetProgress[];
  budgetProgress: BudgetProgress[];
  usedCurrencies: string[];
  rates: ExchangeRates | null;
  ratesFailed: boolean;
  conversionIssue: boolean;
  missingCurrencies: string[];
  hasInvestments: boolean;
  investmentHoldings: InvestmentHoldings;
  debts: Debt[];
  transactions: Transaction[];
  isEmpty: boolean;
  hasAccounts: boolean;
  chartPeriod: '30d' | 'all';
  onChangeChartPeriod: (period: '30d' | 'all') => void;
  recurring: RecurringTransaction[];
  projection: ProjectionPoint[];
  onNavigate: (tab: Tab) => void;
  onFilterTransactions: (filter: 'all' | 'income' | 'expense') => void;
  onShowImport: () => void;
}

export function DashboardPage({
  accounts, dashboardAccountId, onChangeDashboardAccount, stats, overBudget, budgetProgress,
  usedCurrencies, rates, ratesFailed, conversionIssue, missingCurrencies, hasInvestments,
  investmentHoldings, debts, transactions, isEmpty, hasAccounts, chartPeriod, onChangeChartPeriod,
  recurring, projection, onNavigate, onFilterTransactions, onShowImport,
}: DashboardPageProps) {
  return (
    <>
      <div className="mb-8 flex justify-between items-center">
        <h1 className="text-3xl font-bold text-white tracking-tight">Visão Geral</h1>

        {/* ACCOUNT SELECTOR */}
        {accounts.length > 0 && (
          <select
            value={dashboardAccountId || ''}
            onChange={(e) => onChangeDashboardAccount(e.target.value || null)}
            className="bg-white/5 border border-white/10 text-sm text-white py-2 px-4 rounded-xl focus:outline-none focus:border-primary/50"
          >
            <option value="" className="bg-dashboard">Todas as Contas</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id} className="bg-dashboard">{a.name} - {a.bank}</option>
            ))}
          </select>
        )}
      </div>

      {stats.overdueDebts.length > 0 && (
        <div className="mb-6 p-4 rounded-xl flex items-center gap-3" style={{ backgroundColor:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)' }}>
          <AlertCircle size={18} className="text-red-400 shrink-0"/>
          <p className="text-sm text-red-300">
            Você tem <strong>{stats.overdueDebts.length}</strong> dívida(s) com vencimento vencido:
            {' '}{stats.overdueDebts.map(d => d.name).join(', ')}
          </p>
        </div>
      )}

      {/* FIN-047: mesmo padrão de alerta usado para dívidas vencidas, acima. */}
      {overBudget.length > 0 && (
        <div className="mb-6 p-4 rounded-xl flex items-center gap-3" style={{ backgroundColor:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)' }}>
          <AlertCircle size={18} className="text-red-400 shrink-0"/>
          <p className="text-sm text-red-300">
            Você ultrapassou o limite de <strong>{overBudget.length}</strong> orçamento(s) este mês:
            {' '}{overBudget.map(b => b.category).join(', ')}
          </p>
        </div>
      )}

      {/* FIN-076: com moeda estrangeira em uso, os totais são convertidos para real. Uma linha
          discreta diz de que cotação; o aviso âmbar aparece quando algo ficou de fora (moeda
          sem cotação) ou a cotação é antiga. Antes da primeira resposta, nada é exibido. */}
      {usedCurrencies.length > 0 && (rates !== null || ratesFailed) && (
        conversionIssue ? (
          <div role="status" className="mb-6 p-4 rounded-xl flex items-center gap-3" style={{ backgroundColor:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.25)' }}>
            <AlertCircle size={18} className="text-amber-400 shrink-0"/>
            <p className="text-sm text-amber-200">{describeConversion(usedCurrencies, missingCurrencies, rates)}</p>
          </div>
        ) : (
          <p className="text-xs text-textMuted -mt-4 mb-6">{describeConversion(usedCurrencies, missingCurrencies, rates)}</p>
        )
      )}

      {/* Summary Cards Row 1 — Real Accounts */}
      {/* "Saldo Real" exclui investimentos (ver FIN-018) — quando o usuário tem conta de
          investimento ou posição na carteira (FIN-073), o total aparece separado ao lado. */}
      <div className={`grid grid-cols-1 md:grid-cols-3 ${hasInvestments ? 'lg:grid-cols-4' : ''} gap-5 mb-5`}>
        <SummaryCard title="Saldo Real (Contas)" amount={fmt(stats.realBalance)} isPositive={stats.realBalance >= 0}
          icon={<Wallet size={22} style={{ color:'var(--color-primary)' }}/>} badge="Saldo atual" />
        {hasInvestments && (
          <SummaryCard title="Investimentos" amount={fmt(stats.investmentBalance)} isPositive={stats.investmentBalance >= 0}
            icon={<TrendingUp size={22} className="text-teal-400"/>}
            badge={describeHoldings(investmentHoldings)} />
        )}
        <SummaryCard title="Fatura Pendente" amount={fmt(stats.pendingBills)} isPositive={false}
          icon={<CreditCard size={22} className="text-pink-400"/>} badge={`${accounts.filter(a=>a.type==='credit').length} cartão(ões)`} />
        <SummaryCard title="Dívidas Ativas" amount={fmt(stats.activeDebts)} isPositive={false}
          icon={<TrendingDown size={22} className="text-amber-400"/>}
          badge={`${debts.filter(d=>d.paidInstallments < d.totalInstallments).length} pendente(s)`} />
      </div>

      {/* Summary Cards Row 2 — Transactions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        <SummaryCard title="Total de Receitas" amount={fmt(stats.income)} isPositive={true}
          icon={<ArrowUpRight size={22} style={{ color:'var(--color-accent)' }}/>} badge={`${stats.income > 0 ? (transactions.filter(t=>t.amount>0).length) : 0} entradas`}
          onClick={() => { onFilterTransactions('income'); onNavigate('transactions'); }} />
        <SummaryCard title="Total de Despesas" amount={fmt(stats.expense)} isPositive={false}
          icon={<ArrowDownRight size={22} className="text-red-400"/>} badge={`${stats.expense > 0 ? (transactions.filter(t=>t.amount<0).length) : 0} saídas`}
          onClick={() => { onFilterTransactions('expense'); onNavigate('transactions'); }} />
        <SummaryCard title="Este Mês (Gastos)" amount={fmt(stats.monthExpense)} isPositive={false}
          icon={<ArrowDownRight size={22} className="text-orange-400"/>} badge="Mês corrente" />
      </div>

      {/* FIN-046: indicador de orçamento do mês corrente no Dashboard. */}
      {budgetProgress.length > 0 && (
        <div className="glass-card rounded-2xl p-6 mb-8">
          <div className="flex justify-between items-center mb-5">
            <h3 className="text-lg font-semibold text-white">Orçamento do Mês</h3>
            <button onClick={() => onNavigate('budgets')} className="text-xs text-textMuted hover:text-white transition-colors">Ver tudo →</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {budgetProgress.map(b => (
              <div key={b.id}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-white font-medium">{b.category}</span>
                  <span className={b.isOverLimit ? 'text-red-400' : 'text-textMuted'}>{fmt(b.spent)} / {fmt(b.limit)}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--fg-8)' }}>
                  <div className={`h-full rounded-full transition-all ${b.isOverLimit ? 'bg-red-400' : 'bg-primary'}`}
                    style={{ width: `${Math.min(100, b.percentage)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isEmpty && !hasAccounts && (
        <div className="glass-card rounded-2xl p-16 flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-6"
            style={{ background:'linear-gradient(135deg,rgba(99,102,241,0.2),rgba(168,85,247,0.2))', border:'1px solid rgba(99,102,241,0.2)' }}>
            <Wallet size={36} style={{ color:'var(--color-primary)' }}/>
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">Bem-vindo ao FinFlow!</h2>
          <p className="text-textMuted max-w-md mb-8">
            Seu painel financeiro pessoal!
            Adicione suas contas na aba <strong>Contas</strong> e importe seus extratos bancários (CSV/OFX) para acompanhar suas finanças.
          </p>
          <div className="flex gap-3">
            <button onClick={() => onNavigate('accounts')}
              className="px-6 py-3 rounded-xl text-on-accent font-semibold text-sm shadow-md"
              style={{ background:'linear-gradient(135deg,var(--color-primary),var(--color-secondary))', boxShadow:'0 4px 24px rgba(99,102,241,0.35)' }}>
              <span className="flex items-center gap-2"><Wallet size={16}/> Adicionar Conta</span>
            </button>
            <button onClick={onShowImport}
              className="px-6 py-3 rounded-xl text-textMuted text-sm font-medium border border-white/10 hover:bg-white/5 hover:text-white transition-colors">
              <span className="flex items-center gap-2"><Upload size={16}/> Importar Extrato</span>
            </button>
          </div>
        </div>
      )}

      {(!isEmpty || hasAccounts) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-2 glass-card rounded-2xl p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-semibold text-white">Fluxo Financeiro</h3>
              <div className="flex bg-white/5 p-1 rounded-xl border border-white/5">
                <button
                  onClick={() => onChangeChartPeriod('30d')}
                  className={`px-3 py-1.5 text-[10px] uppercase font-bold rounded-lg transition-all ${chartPeriod === '30d' ? 'bg-primary text-on-accent shadow-lg' : 'text-textMuted hover:text-white'}`}
                >
                  30 Dias
                </button>
                <button
                  onClick={() => onChangeChartPeriod('all')}
                  className={`px-3 py-1.5 text-[10px] uppercase font-bold rounded-lg transition-all ${chartPeriod === 'all' ? 'bg-primary text-on-accent shadow-lg' : 'text-textMuted hover:text-white'}`}
                >
                  Histórico
                </button>
              </div>
            </div>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartPeriod === '30d' ? stats.dailyEvolution : stats.balanceByMonth}>
                  <defs>
                    <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false}/>
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize:10 }}
                    interval={chartPeriod === '30d' ? 4 : 0}
                  />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize:10 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`}/>
                  <RechartsTooltip
                    contentStyle={{ backgroundColor:'var(--tooltip-bg)', border:'1px solid var(--tooltip-border)', borderRadius:12 }}
                    formatter={(v) => [fmt(Number(v)), chartPeriod === '30d' ? 'Evolução' : 'Saldo']}
                    labelStyle={{ color:'var(--color-textMuted)' }}
                  />
                  <Area type="monotone" dataKey="balance" stroke="#6366f1" strokeWidth={2.5} fill="url(#cg)" animationDuration={1000}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {stats.expenseByCategory.length > 0 && (
            <div className="glass-card rounded-2xl p-6">
              <h3 className="text-lg font-semibold text-white mb-6">Por Categoria</h3>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.expenseByCategory} layout="vertical" margin={{ left:-10, right:10 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false}/>
                    <XAxis type="number" hide/>
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize:11 }} width={80}/>
                    <RechartsTooltip
                      contentStyle={{ backgroundColor:'var(--tooltip-bg)', border:'1px solid var(--tooltip-border)', borderRadius:12 }}
                      formatter={(v) => [fmt(Number(v)),'Gasto']}/>
                    <Bar dataKey="amount" radius={[0,4,4,0]} barSize={14}>
                      {stats.expenseByCategory.map(e => (
                        <Cell key={e.name} fill={CATEGORY_COLORS[e.name] || '#6366f1'}/>
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {/* FIN-059: projeção de saldo — só aparece quando há algo a projetar
          (recorrência ativa ou dívida em aberto), senão seria uma linha reta. */}
      {(recurring.some(r => r.active) || debts.length > 0) && (
        <div className="glass-card rounded-2xl p-6 mb-8">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-semibold text-white">Projeção de Saldo</h3>
            <span className="text-[10px] uppercase tracking-wider font-bold text-textMuted bg-white/5 px-2.5 py-1 rounded-full border border-white/5">
              Próximos 6 meses
            </span>
          </div>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={projection}>
                <defs>
                  <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#14b8a6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false}/>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize:10 }}/>
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize:10 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`}/>
                <RechartsTooltip
                  contentStyle={{ backgroundColor:'var(--tooltip-bg)', border:'1px solid var(--tooltip-border)', borderRadius:12 }}
                  formatter={(v) => [fmt(Number(v)), 'Saldo projetado']}
                  labelStyle={{ color:'var(--color-textMuted)' }}
                />
                <Area type="monotone" dataKey="balance" stroke="#14b8a6" strokeWidth={2.5} fill="url(#pg)" animationDuration={1000}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-textMuted mt-3">
            Saldo real de hoje somado às recorrências ativas e descontadas as parcelas de dívidas em aberto.
          </p>
        </div>
      )}
    </>
  );
}
