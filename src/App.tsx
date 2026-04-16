import { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard, Wallet, ArrowRightLeft, Upload, Trash2,
  Bell, Search, ArrowUpRight, ArrowDownRight, CreditCard, AlertCircle, TrendingDown,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';
import { ImportModal } from './components/ImportModal';
import { AccountsManager } from './components/AccountsManager';
import { DebtManager } from './components/DebtManager';
import type { Transaction } from './utils/parsers';
import type { Account, Debt } from './types';

const TXS_KEY      = 'finance_transactions';
const ACCOUNTS_KEY = 'finance_accounts';
const DEBTS_KEY    = 'finance_debts';

const CATEGORY_COLORS: Record<string, string> = {
  'Alimentação': '#f59e0b', 'Transporte': '#3b82f6', 'Lazer': '#a855f7',
  'Moradia': '#6366f1', 'Saúde': '#10b981', 'Educação': '#06b6d4',
  'Compras': '#ec4899', 'Receita': '#14b8a6', 'Outros': '#6b7280',
};

type Tab = 'dashboard' | 'transactions' | 'accounts' | 'debts';

function fmt(v: number) {
  return `R$ ${Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

function load<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    if (!s) return fallback;
    const p = JSON.parse(s);
    return Array.isArray(fallback) ? (Array.isArray(p) ? p : fallback) : p;
  } catch { return fallback; }
}

export default function App() {
  const [activeTab, setActiveTab]     = useState<Tab>('dashboard');
  const [showImport, setShowImport]   = useState(false);
  const [search, setSearch]           = useState('');
  const [txFilter, setTxFilter]       = useState<'all' | 'income' | 'expense'>('all');
  const [transactions, setTxs]        = useState<Transaction[]>(() => load(TXS_KEY, []));
  const [accounts, setAccounts]       = useState<Account[]>(() => load(ACCOUNTS_KEY, []));
  const [debts, setDebts]             = useState<Debt[]>(() => load(DEBTS_KEY, []));

  useEffect(() => { localStorage.setItem(TXS_KEY, JSON.stringify(transactions)); }, [transactions]);
  useEffect(() => { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts)); }, [accounts]);
  useEffect(() => { localStorage.setItem(DEBTS_KEY, JSON.stringify(debts)); }, [debts]);

  const handleImport = (newTxs: Transaction[]) => {
    setTxs(prev => {
      const ids = new Set(prev.map(t => t.id));
      return [...prev, ...newTxs.filter(t => !ids.has(t.id))]
        .sort((a, b) => b.date.localeCompare(a.date));
    });
  };

  // ---------- Derived stats ----------
  const stats = useMemo(() => {
    const income  = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const expense = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    const importedBalance = income - expense;

    // Monthly flow chart
    const monthMap: Record<string, number> = {};
    transactions.forEach(tx => {
      const m = tx.date.slice(0, 7);
      monthMap[m] = (monthMap[m] ?? 0) + tx.amount;
    });
    const balanceByMonth = Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b)).slice(-7)
      .map(([k, v]) => ({
        name: new Date(k + '-15').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
        balance: +v.toFixed(2),
      }));

    // Category breakdown
    const catMap: Record<string, number> = {};
    transactions.filter(t => t.amount < 0).forEach(t => {
      catMap[t.category] = (catMap[t.category] ?? 0) + Math.abs(t.amount);
    });
    const expenseByCategory = Object.entries(catMap)
      .sort(([, a], [, b]) => b - a).slice(0, 6)
      .map(([name, amount]) => ({ name, amount: +amount.toFixed(2) }));

    // Current month
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthExpense = transactions
      .filter(t => t.amount < 0 && t.date.startsWith(thisMonth))
      .reduce((s, t) => s + Math.abs(t.amount), 0);

    // Real balance from manually entered accounts
    const realBalance   = accounts.filter(a => a.type !== 'credit').reduce((s, a) => s + a.balance, 0);
    const pendingBills  = accounts.filter(a => a.type === 'credit').reduce((s, a) => s + (a.pendingBill ?? 0), 0);
    const activeDebts   = debts.reduce((s, d) => s + Math.max(0, d.totalAmount - d.paidAmount), 0);
    const overdueDebts  = debts.filter(d => d.paidInstallments < d.totalInstallments && new Date(d.nextDueDate) < now);

    return { income, expense, importedBalance, balanceByMonth, expenseByCategory, monthExpense, realBalance, pendingBills, activeDebts, overdueDebts };
  }, [transactions, accounts, debts]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return transactions
      .filter(t => {
        if (txFilter === 'income')  return t.amount > 0;
        if (txFilter === 'expense') return t.amount < 0;
        return true;
      })
      .filter(t => t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
  }, [transactions, search, txFilter]);

  const hasAccounts = accounts.length > 0;
  const isEmpty     = transactions.length === 0;

  // ---------- Render ----------
  return (
    <div className="flex h-screen overflow-hidden relative" style={{ backgroundColor: 'var(--color-background)' }}>
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 rounded-full blur-[100px] pointer-events-none" style={{ backgroundColor: 'rgba(99,102,241,0.12)' }} />
      <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none" style={{ backgroundColor: 'rgba(168,85,247,0.07)' }} />

      {/* ── Sidebar ── */}
      <aside className="w-64 glass-panel border-r border-white/5 hidden md:flex flex-col justify-between z-10">
        <div>
          <div className="p-6 flex items-center space-x-3 text-white">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-lg"
              style={{ background: 'linear-gradient(135deg,var(--color-primary),var(--color-secondary))' }}>F</div>
            <span className="text-xl font-bold">Fin<span style={{ color: 'var(--color-primary)', fontWeight: 300 }}>Flow</span></span>
          </div>

          <nav className="mt-4 px-4 space-y-1">
            <NavItem icon={<LayoutDashboard size={18}/>} label="Dashboard"   active={activeTab==='dashboard'}   onClick={() => setActiveTab('dashboard')} />
            <NavItem icon={<ArrowRightLeft size={18}/>}  label="Transações"  active={activeTab==='transactions'} onClick={() => setActiveTab('transactions')} />
            <NavItem icon={<Wallet size={18}/>}          label="Contas"      active={activeTab==='accounts'}     onClick={() => setActiveTab('accounts')} badge={accounts.length > 0 ? accounts.length : undefined} />
            <NavItem icon={<TrendingDown size={18}/>}    label="Dívidas"     active={activeTab==='debts'}        onClick={() => setActiveTab('debts')}
              badge={debts.filter(d => d.paidInstallments < d.totalInstallments).length > 0
                ? debts.filter(d => d.paidInstallments < d.totalInstallments).length : undefined}
              badgeColor={stats.overdueDebts.length > 0 ? '#ef4444' : undefined}
            />
          </nav>
        </div>

        <div className="p-5 space-y-2">
          <button onClick={() => setShowImport(true)}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all"
            style={{ background: 'linear-gradient(135deg,var(--color-primary),var(--color-secondary))', boxShadow: '0 4px 20px rgba(99,102,241,0.25)' }}>
            <Upload size={15}/> Importar Extrato
          </button>
          {transactions.length > 0 && (
            <button onClick={() => confirm('Remover todas as transações?') && setTxs([])}
              className="w-full py-2 text-xs text-textMuted hover:text-red-400 flex items-center justify-center gap-1 transition-colors">
              <Trash2 size={12}/> Limpar transações
            </button>
          )}
          <p className="text-center text-xs text-textMuted">{transactions.length} transações</p>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col h-screen overflow-y-auto z-10">
        {/* Topbar */}
        <header className="h-20 px-8 flex items-center justify-between border-b border-white/5 glass-panel sticky top-0 z-20">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" size={16}/>
            <input type="text" placeholder="Buscar transação..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full border rounded-full py-2 pl-9 pr-4 text-sm text-white focus:outline-none transition-colors"
              style={{ backgroundColor:'rgba(18,18,26,0.5)', borderColor:'rgba(255,255,255,0.06)' }}/>
          </div>
          <div className="flex items-center space-x-5">
            <button className="relative text-textMuted hover:text-white transition-colors">
              <Bell size={20}/>
              {(stats.overdueDebts.length > 0) && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500"/>}
            </button>
            <div className="flex items-center space-x-3 cursor-pointer">
              <img src="https://ui-avatars.com/api/?name=Vitor&background=6366f1&color=fff" alt="avatar" className="w-9 h-9 rounded-full border-2" style={{ borderColor:'rgba(99,102,241,0.3)' }}/>
              <div className="hidden md:block">
                <p className="text-sm font-medium text-white">Vitor</p>
                <p className="text-xs text-textMuted">Conta Pessoal</p>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 p-8">

          {/* ══════════ DASHBOARD TAB ══════════ */}
          {activeTab === 'dashboard' && (
            <>
              <div className="flex justify-between items-end mb-8">
                <div>
                  <h1 className="text-3xl font-bold text-white mb-1">Visão Geral</h1>
                  <p className="text-textMuted text-sm">
                    {isEmpty ? 'Importe um extrato para começar' : `${transactions.length} transações carregadas`}
                  </p>
                </div>
              </div>

              {/* Overdue alert */}
              {stats.overdueDebts.length > 0 && (
                <div className="mb-6 p-4 rounded-xl flex items-center gap-3" style={{ backgroundColor:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)' }}>
                  <AlertCircle size={18} className="text-red-400 shrink-0"/>
                  <p className="text-sm text-red-300">
                    Você tem <strong>{stats.overdueDebts.length}</strong> dívida(s) com vencimento vencido:
                    {' '}{stats.overdueDebts.map(d => d.name).join(', ')}
                  </p>
                </div>
              )}

              {/* Summary Cards Row 1 — Real Accounts */}
              {hasAccounts && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5">
                  <SummaryCard title="Saldo Real (Contas)" amount={fmt(stats.realBalance)} isPositive={stats.realBalance >= 0}
                    icon={<Wallet size={22} style={{ color:'var(--color-primary)' }}/>} badge="Saldo atual" />
                  <SummaryCard title="Fatura Pendente" amount={fmt(stats.pendingBills)} isPositive={false}
                    icon={<CreditCard size={22} className="text-pink-400"/>} badge={`${accounts.filter(a=>a.type==='credit').length} cartão(ões)`} />
                  <SummaryCard title="Dívidas Ativas" amount={fmt(stats.activeDebts)} isPositive={false}
                    icon={<TrendingDown size={22} className="text-amber-400"/>}
                    badge={`${debts.filter(d=>d.paidInstallments < d.totalInstallments).length} pendente(s)`} />
                </div>
              )}

              {/* Summary Cards Row 2 — Transactions */}
              {!isEmpty && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
                  <SummaryCard title="Total de Receitas" amount={fmt(stats.income)} isPositive={true}
                    icon={<ArrowUpRight size={22} style={{ color:'var(--color-accent)' }}/>} badge={`${transactions.filter(t=>t.amount>0).length} entradas`}
                    onClick={() => { setTxFilter('income'); setActiveTab('transactions'); }} />
                  <SummaryCard title="Total de Despesas" amount={fmt(stats.expense)} isPositive={false}
                    icon={<ArrowDownRight size={22} className="text-red-400"/>} badge={`${transactions.filter(t=>t.amount<0).length} saídas`}
                    onClick={() => { setTxFilter('expense'); setActiveTab('transactions'); }} />
                  <SummaryCard title="Este Mês (Gastos)" amount={fmt(stats.monthExpense)} isPositive={false}
                    icon={<ArrowDownRight size={22} className="text-orange-400"/>} badge="Mês corrente" />
                </div>
              )}

              {isEmpty && !hasAccounts && (
                <div className="glass-card rounded-2xl p-16 flex flex-col items-center text-center">
                  <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-6"
                    style={{ background:'linear-gradient(135deg,rgba(99,102,241,0.2),rgba(168,85,247,0.2))', border:'1px solid rgba(99,102,241,0.2)' }}>
                    <Upload size={36} style={{ color:'var(--color-primary)' }}/>
                  </div>
                  <h2 className="text-2xl font-bold text-white mb-3">Bem-vindo ao FinFlow!</h2>
                  <p className="text-textMuted max-w-md mb-8">
                    Importe um extrato (<strong className="text-white">.OFX</strong> ou <strong className="text-white">.CSV</strong>),
                    cadastre suas contas na aba <strong className="text-white">Contas</strong> e adicione suas dívidas na aba <strong className="text-white">Dívidas</strong>.
                  </p>
                  <div className="flex gap-3">
                    <button onClick={() => setShowImport(true)}
                      className="px-6 py-3 rounded-xl text-white font-semibold text-sm"
                      style={{ background:'linear-gradient(135deg,var(--color-primary),var(--color-secondary))', boxShadow:'0 4px 24px rgba(99,102,241,0.35)' }}>
                      <span className="flex items-center gap-2"><Upload size={16}/> Importar Extrato</span>
                    </button>
                    <button onClick={() => setActiveTab('accounts')}
                      className="px-6 py-3 rounded-xl text-white text-sm font-medium border border-white/10 hover:bg-white/5 transition-colors">
                      <span className="flex items-center gap-2"><Wallet size={16}/> Criar Conta</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Charts */}
              {stats.balanceByMonth.length > 1 && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                  <div className="lg:col-span-2 glass-card rounded-2xl p-6">
                    <h3 className="text-lg font-semibold text-white mb-6">Fluxo Mensal</h3>
                    <div className="h-60">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={stats.balanceByMonth}>
                          <defs>
                            <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" vertical={false}/>
                          <XAxis dataKey="name" stroke="#6b7280" axisLine={false} tickLine={false} tick={{ fontSize:12 }}/>
                          <YAxis stroke="#6b7280" axisLine={false} tickLine={false} tick={{ fontSize:11 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`}/>
                          <RechartsTooltip contentStyle={{ backgroundColor:'#1c1c24', border:'1px solid rgba(255,255,255,0.1)', borderRadius:12 }}
                            formatter={(v:number) => [fmt(v),'Saldo']} labelStyle={{ color:'#9ca3af' }}/>
                          <Area type="monotone" dataKey="balance" stroke="#6366f1" strokeWidth={2.5} fill="url(#cg)"/>
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
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" horizontal={false}/>
                            <XAxis type="number" hide/>
                            <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} stroke="#6b7280" tick={{ fontSize:11 }} width={80}/>
                            <RechartsTooltip cursor={{ fill:'rgba(255,255,255,0.03)' }}
                              contentStyle={{ backgroundColor:'#1c1c24', border:'1px solid rgba(255,255,255,0.1)', borderRadius:12 }}
                              formatter={(v:number) => [fmt(v),'Gasto']}/>
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

              {/* Recent transactions */}
              {!isEmpty && (
                <div className="glass-card rounded-2xl p-6">
                  <div className="flex justify-between items-center mb-5">
                    <h3 className="text-lg font-semibold text-white">Últimas Transações</h3>
                    <button onClick={() => setActiveTab('transactions')} className="text-xs font-medium transition-colors hover:opacity-80" style={{ color:'var(--color-primary)' }}>Ver todas</button>
                  </div>
                  <TxTable rows={transactions.slice(0, 10)}/>
                </div>
              )}
            </>
          )}

          {activeTab === 'transactions' && (
            <>
              <div className="flex justify-between items-end mb-6">
                <div>
                  <h1 className="text-3xl font-bold text-white mb-1">Transações</h1>
                  <p className="text-textMuted text-sm">{filtered.length} registros</p>
                </div>
                <button onClick={() => setShowImport(true)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-white font-medium transition-colors"
                  style={{ backgroundColor:'var(--color-primary)' }}>
                  <Upload size={15}/> Importar
                </button>
              </div>

              {/* Filter buttons */}
              <div className="flex gap-2 mb-5">
                {([
                  { key: 'all',     label: 'Todas',     color: 'rgba(99,102,241,0.15)',  border: 'rgba(99,102,241,0.4)',  text: '#a5b4fc' },
                  { key: 'income',  label: '↑ Receitas', color: 'rgba(20,184,166,0.12)', border: 'rgba(20,184,166,0.4)', text: '#5eead4' },
                  { key: 'expense', label: '↓ Despesas', color: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.4)',  text: '#fca5a5' },
                ] as const).map(f => (
                  <button key={f.key} onClick={() => setTxFilter(f.key)}
                    className="px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200"
                    style={{
                      backgroundColor: txFilter === f.key ? f.color : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${txFilter === f.key ? f.border : 'rgba(255,255,255,0.08)'}`,
                      color: txFilter === f.key ? f.text : 'var(--color-textMuted)',
                      transform: txFilter === f.key ? 'scale(1.02)' : 'scale(1)',
                    }}>
                    {f.label}
                    {f.key !== 'all' && (
                      <span className="ml-2 text-xs opacity-70">
                        {f.key === 'income'
                          ? transactions.filter(t=>t.amount>0).length
                          : transactions.filter(t=>t.amount<0).length}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div className="glass-card rounded-2xl p-6">
                {filtered.length === 0 ? (
                  <p className="text-center text-textMuted py-12 text-sm">Nenhuma transação encontrada.</p>
                ) : (
                  <TxTable rows={filtered.slice(0, 200)}/>
                )}
              </div>
            </>
          )}

          {/* ══════════ ACCOUNTS TAB ══════════ */}
          {activeTab === 'accounts' && (
            <>
              <div className="mb-6">
                <h1 className="text-3xl font-bold text-white mb-1">Contas e Cartões</h1>
                <p className="text-textMuted text-sm">Seu saldo real e faturas pendentes</p>
              </div>
              <AccountsManager accounts={accounts} onChange={setAccounts}/>
            </>
          )}

          {/* ══════════ DEBTS TAB ══════════ */}
          {activeTab === 'debts' && (
            <>
              <div className="mb-6">
                <h1 className="text-3xl font-bold text-white mb-1">Dívidas</h1>
                <p className="text-textMuted text-sm">Controle de empréstimos, financiamentos e pendências</p>
              </div>
              <DebtManager debts={debts} onChange={setDebts}/>
            </>
          )}
        </div>
      </main>

      {showImport && <ImportModal onClose={() => setShowImport(false)} onImport={handleImport}/>}
    </div>
  );
}

// ── Shared sub-components ──

function NavItem({ icon, label, active=false, onClick=()=>{}, badge, badgeColor }:
  { icon: React.ReactNode; label: string; active?: boolean; onClick?: ()=>void; badge?: number; badgeColor?: string }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center space-x-3 px-4 py-2.5 rounded-xl transition-all duration-200 text-sm"
      style={{
        backgroundColor: active ? 'rgba(99,102,241,0.1)' : 'transparent',
        color: active ? 'var(--color-primary)' : 'var(--color-textMuted)',
        border: active ? '1px solid rgba(99,102,241,0.2)' : '1px solid transparent',
      }}>
      {icon}
      <span className="font-medium flex-1 text-left">{label}</span>
      {badge !== undefined && (
        <span className="text-xs px-2 py-0.5 rounded-full font-bold"
          style={{ backgroundColor: badgeColor ? `${badgeColor}20` : 'rgba(255,255,255,0.08)', color: badgeColor ?? 'var(--color-textMuted)' }}>
          {badge}
        </span>
      )}
      {active && <div className="w-1 h-4 rounded-full" style={{ backgroundColor:'var(--color-primary)', boxShadow:'0 0 8px rgba(99,102,241,0.8)' }}/>}
    </button>
  );
}

function SummaryCard({ title, amount, isPositive, icon, badge, onClick }:
  { title:string; amount:string; isPositive:boolean; icon:React.ReactNode; badge:string; onClick?: ()=>void }) {
  const isClickable = !!onClick;
  return (
    <div
      onClick={onClick}
      className={`glass-card rounded-2xl p-5 relative overflow-hidden group transition-all duration-300 ${
        isClickable ? 'cursor-pointer hover:-translate-y-1 hover:shadow-lg' : 'hover:-translate-y-0.5'
      }`}
      style={isClickable ? { border:'1px solid rgba(255,255,255,0.12)' } : undefined}
    >
      {isClickable && (
        <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <ArrowUpRight size={14} className="text-textMuted rotate-45"/>
        </div>
      )}
      <div className="flex justify-between items-start mb-3 relative z-10">
        <p className="text-xs font-medium text-textMuted uppercase tracking-wide">{title}</p>
        <div className="p-2.5 rounded-xl" style={{ backgroundColor:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.07)' }}>
          {icon}
        </div>
      </div>
      <h2 className="text-2xl font-bold text-white mb-3 relative z-10">{amount}</h2>
      <span className="text-xs font-semibold px-2.5 py-1 rounded-lg relative z-10"
        style={{
          backgroundColor: isPositive ? 'rgba(20,184,166,0.12)' : 'rgba(239,68,68,0.10)',
          color: isPositive ? 'var(--color-accent)' : '#f87171',
        }}>
        {badge}{isClickable && ' →'}
      </span>
      <div className="absolute -bottom-8 -right-8 w-28 h-28 rounded-full blur-2xl opacity-50"
        style={{ backgroundColor:'rgba(255,255,255,0.03)' }}/>
    </div>
  );
}

function TxTable({ rows }: { rows: Transaction[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="text-xs text-textMuted uppercase tracking-wider border-b border-white/5">
            <th className="pb-3 font-medium">Descrição</th>
            <th className="pb-3 font-medium">Categoria</th>
            <th className="pb-3 font-medium">Data</th>
            <th className="pb-3 font-medium text-right">Valor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(tx => (
            <tr key={tx.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
              <td className="py-3 text-sm text-white font-medium max-w-[240px] truncate pr-4">{tx.name}</td>
              <td className="py-3 text-sm">
                <span className="inline-block px-2.5 py-1 rounded-full text-xs border border-white/10"
                  style={{ backgroundColor:`${CATEGORY_COLORS[tx.category]||'#6366f1'}15`, color:CATEGORY_COLORS[tx.category]||'#6366f1' }}>
                  {tx.category}
                </span>
              </td>
              <td className="py-3 text-xs text-textMuted">
                {new Date(tx.date+'T12:00:00').toLocaleDateString('pt-BR')}
              </td>
              <td className={`py-3 text-sm font-semibold text-right ${tx.amount>0?'text-accent':'text-white'}`}>
                {tx.amount>0?'+':''}{fmt(tx.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
