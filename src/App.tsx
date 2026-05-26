import { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard, Wallet, ArrowRightLeft, Upload, Trash2,
  Bell, Search, ArrowUpRight, ArrowDownRight, CreditCard, AlertCircle, TrendingDown,
  LogOut
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';
import { ImportModal } from './components/ImportModal';
import { AccountsManager } from './components/AccountsManager';
import { DebtManager } from './components/DebtManager';
import { AuthForm } from './components/AuthForm';
import type { Account, Debt, Transaction } from './types';

const CATEGORY_COLORS: Record<string, string> = {
  'Alimentação': '#f59e0b', 'Transporte': '#3b82f6', 'Lazer': '#a855f7',
  'Moradia': '#6366f1', 'Saúde': '#10b981', 'Educação': '#06b6d4',
  'Compras': '#ec4899', 'Receita': '#14b8a6', 'Outros': '#6b7280',
};

type Tab = 'dashboard' | 'transactions' | 'accounts' | 'debts';

function fmt(v: number) {
  return `R$ ${Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('finflow_token'));
  const [user, setUser]   = useState<any>(null);
  const [loading, setLoading] = useState(!!token);

  const [activeTab, setActiveTab]     = useState<Tab>('dashboard');
  const [showImport, setShowImport]   = useState(false);
  const [search, setSearch]           = useState('');
  const [txFilter, setTxFilter]       = useState<'all' | 'income' | 'expense'>('all');
  const [dashboardAccountId, setDashboardAccountId] = useState<string | null>(null);
  const [chartPeriod, setChartPeriod] = useState<'30d' | 'all'>('30d');
  
  const [transactions, setTxs]        = useState<Transaction[]>([]);
  const [accounts, setAccounts]       = useState<Account[]>([]);
  const [debts, setDebts]             = useState<Debt[]>([]);

  const fetchAPI = async (endpoint: string, method = 'GET', body?: any) => {
    const res = await fetch(`http://localhost:3001${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Erro na API');
    }
    return res.json();
  };

  useEffect(() => {
    if (token) {
      setLoading(true);
      Promise.all([
        fetchAPI('/api/auth/me'),
        fetchAPI('/api/accounts'),
        fetchAPI('/api/transactions'),
        fetchAPI('/api/debts')
      ]).then(([meData, accsData, txsData, debtsData]) => {
        setUser(meData.user);
        setAccounts(accsData);
        setTxs(txsData);
        setDebts(debtsData);
      }).catch(err => {
        console.error('Sessão expirada ou erro:', err);
        handleLogout();
      }).finally(() => {
        setLoading(false);
      });
    }
  }, [token]);

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    setAccounts([]);
    setTxs([]);
    setDebts([]);
    localStorage.removeItem('finflow_token');
  };

  const handleLogin = (newToken: string, newUser: any) => {
    localStorage.setItem('finflow_token', newToken);
    setToken(newToken);
    setUser(newUser);
  };

  /* --- API Mappers --- */
  const handleImport = async (newTxs: Transaction[]) => {
    try {
      const res = await fetchAPI('/api/transactions', 'POST', { transactions: newTxs });
      if (res.success) {
        const txsData = await fetchAPI('/api/transactions');
        setTxs(txsData);
      }
    } catch (e: any) { alert("Erro ao importar: " + e.message); }
  };



  // CRUD ACCOUNTS
  const addAccount = async (acc: Omit<Account, 'id' | 'createdAt'>) => {
    try {
      const newAcc = await fetchAPI('/api/accounts', 'POST', acc);
      setAccounts(prev => [...prev, newAcc]);
    } catch (e: any) { alert(e.message); throw e; }
  };
  const updateAccount = async (id: string, acc: Omit<Account, 'id' | 'createdAt'>) => {
    try {
      await fetchAPI(`/api/accounts/${id}`, 'PUT', acc);
      setAccounts(prev => prev.map(a => a.id === id ? { ...a, ...acc } : a));
    } catch (e: any) { alert(e.message); throw e; }
  };
  const deleteAccount = async (id: string) => {
    try {
      await fetchAPI(`/api/accounts/${id}`, 'DELETE');
      setAccounts(prev => prev.filter(a => a.id !== id));
    } catch (e: any) { alert(e.message); throw e; }
  };

  // CRUD DEBTS
  const addDebt = async (debt: Omit<Debt, 'id' | 'createdAt'>) => {
    try {
      const newDebt = await fetchAPI('/api/debts', 'POST', debt);
      setDebts(prev => [...prev, newDebt]);
    } catch (e: any) { alert(e.message); throw e; }
  };
  const deleteDebt = async (id: string) => {
    try {
      await fetchAPI(`/api/debts/${id}`, 'DELETE');
      setDebts(prev => prev.filter(d => d.id !== id));
    } catch (e: any) { alert(e.message); throw e; }
  };


  // ---------- Derived stats ----------
  const stats = useMemo(() => {
    const activeTxs = dashboardAccountId 
      ? transactions.filter(t => t.accountId === dashboardAccountId)
      : transactions;
      
    const activeAccs = dashboardAccountId 
      ? accounts.filter(a => a.id === dashboardAccountId)
      : accounts;
      
    const activeDebts = dashboardAccountId 
      ? debts.filter(d => d.accountId === dashboardAccountId)
      : debts;

    const income  = activeTxs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
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

    const today = new Date().toISOString().slice(0, 10);
    const mPrefix = today.slice(0, 7);
    const monthExpense = activeTxs.filter(t => t.amount < 0 && t.date.startsWith(mPrefix)).reduce((s, t) => s + Math.abs(t.amount), 0);

    const realBalance = activeAccs.filter(a => a.type !== 'credit').reduce((s, a) => s + a.balance, 0);
    const pendingBills = activeAccs.filter(a => a.type === 'credit').reduce((s, a) => s + (a.pendingBill ?? 0), 0);
    const totalActiveDebts = activeDebts.reduce((s, d) => s + (d.totalAmount - d.paidAmount), 0);
    
    const overdueDebts = activeDebts.filter(d => d.nextDueDate < today && d.paidInstallments < d.totalInstallments);

    const dailyMap: Record<string, number> = {};
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const startStr = thirtyDaysAgo.toISOString().substring(0, 10);
    
    activeTxs.filter(t => t.date >= startStr).forEach(t => {
       dailyMap[t.date] = (dailyMap[t.date] ?? 0) + t.amount;
    });
    const dailyEvolution = Object.entries(dailyMap).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => {
       return { name: k.substring(5).replace('-','/'), balance: v };
    });

    return { 
      income, expense, importedBalance, balanceByMonth, dailyEvolution, 
      expenseByCategory, monthExpense, realBalance, pendingBills, activeDebts: totalActiveDebts, overdueDebts,
      filteredTxsCount: activeTxs.length
    };
  }, [transactions, accounts, debts, dashboardAccountId]);

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

  if (!token) return <AuthForm onLogin={handleLogin} />;
  if (loading) return <div className="h-screen w-full flex items-center justify-center bg-[#0a0a0f] text-white">Carregando Banco de Dados...</div>;

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
            <NavItem icon={<LayoutDashboard size={18}/>} label="Dashboard" active={activeTab==='dashboard'} onClick={() => setActiveTab('dashboard')} />
            
            <div className="space-y-1">
              <NavItem icon={<Wallet size={18}/>} label="Contas" active={activeTab==='accounts'} onClick={() => setActiveTab('accounts')} badge={accounts.length > 0 ? accounts.length : undefined} />
              
              {accounts.length > 0 && (
                <div className="ml-6 pl-2 border-l border-white/10 space-y-1 mt-1 transition-all">
                  <NavItem icon={<ArrowRightLeft size={16}/>} label="Transações" active={activeTab==='transactions'} onClick={() => setActiveTab('transactions')} isSubItem />
                  <NavItem icon={<TrendingDown size={16}/>} label="Dívidas" active={activeTab==='debts'} onClick={() => setActiveTab('debts')} isSubItem
                    badge={debts.filter(d => d.paidInstallments < d.totalInstallments).length > 0 ? debts.filter(d => d.paidInstallments < d.totalInstallments).length : undefined}
                    badgeColor={stats.overdueDebts.length > 0 ? '#ef4444' : undefined}
                  />
                </div>
              )}
            </div>
          </nav>
        </div>

        <div className="p-5 space-y-2">
          <div className="mb-4 flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
              <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">{user?.name}</p>
                  <p className="text-xs text-textMuted truncate">{user?.email}</p>
              </div>
              <button onClick={handleLogout} className="p-2 ml-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors">
                  <LogOut size={14}/>
              </button>
          </div>

          <button onClick={() => setActiveTab('accounts')}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all shadow-lg"
            style={{ background: 'linear-gradient(135deg,var(--color-primary),var(--color-secondary))', boxShadow: '0 4px 20px rgba(99,102,241,0.25)' }}>
            <Wallet size={15}/> Gerenciar Contas
          </button>
          <button onClick={() => setShowImport(true)}
            className="w-full py-3 rounded-xl border border-white/10 text-xs font-medium text-textMuted hover:text-white flex items-center justify-center gap-2 transition-all hover:bg-white/5">
            <Upload size={14}/> Importação Manual
          </button>
          {transactions.length > 0 && (
            <button onClick={async () => {
                if (confirm('Remover todas as transações?')) {
                    await fetchAPI('/api/transactions/bulk', 'DELETE');
                    setTxs([]);
                }
            }}
              className="w-full py-2.5 rounded-xl border border-red-500/10 text-red-400 hover:bg-red-500/10 text-xs font-medium flex items-center justify-center gap-2 transition-all">
              <Trash2 size={14}/> Limpar Transações
            </button>
          )}
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 overflow-y-auto z-10 custom-scrollbar">
        <header className="sticky top-0 z-20 backdrop-blur-xl bg-[#0a0a0f]/80 border-b border-white/5 px-8 py-5 flex justify-between items-center">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" size={18} />
              <input type="text" placeholder="Buscar transações, contas..." value={search} onChange={e => { setSearch(e.target.value); setActiveTab('transactions'); }}
                className="w-full bg-white/5 border border-white/10 rounded-full pl-10 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50 transition-colors" />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button className="relative p-2 rounded-full hover:bg-white/5 transition-colors">
              <Bell size={20} className="text-textMuted" />
              {stats.overdueDebts.length > 0 && <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-[#0a0a0f]"/>}
            </button>
          </div>
        </header>

        <div className="p-8 max-w-7xl mx-auto pb-24">
          
          {/* ══════════ DASHBOARD TAB ══════════ */}
          {activeTab === 'dashboard' && (
            <>
              <div className="mb-8 flex justify-between items-center">
                <h1 className="text-3xl font-bold text-white tracking-tight">Visão Geral</h1>
                
                {/* ACCOUNT SELECTOR */}
                {accounts.length > 0 && (
                  <select 
                    value={dashboardAccountId || ''}
                    onChange={(e) => setDashboardAccountId(e.target.value || null)}
                    className="bg-white/5 border border-white/10 text-sm text-white py-2 px-4 rounded-xl focus:outline-none focus:border-primary/50"
                  >
                    <option value="" className="bg-[#12121a]">Todas as Contas</option>
                    {accounts.map(a => (
                      <option key={a.id} value={a.id} className="bg-[#12121a]">{a.name} - {a.bank}</option>
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

              {/* Summary Cards Row 1 — Real Accounts */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5">
                <SummaryCard title="Saldo Real (Contas)" amount={fmt(stats.realBalance)} isPositive={stats.realBalance >= 0}
                  icon={<Wallet size={22} style={{ color:'var(--color-primary)' }}/>} badge="Saldo atual" />
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
                  onClick={() => { setTxFilter('income'); setActiveTab('transactions'); }} />
                <SummaryCard title="Total de Despesas" amount={fmt(stats.expense)} isPositive={false}
                  icon={<ArrowDownRight size={22} className="text-red-400"/>} badge={`${stats.expense > 0 ? (transactions.filter(t=>t.amount<0).length) : 0} saídas`}
                  onClick={() => { setTxFilter('expense'); setActiveTab('transactions'); }} />
                <SummaryCard title="Este Mês (Gastos)" amount={fmt(stats.monthExpense)} isPositive={false}
                  icon={<ArrowDownRight size={22} className="text-orange-400"/>} badge="Mês corrente" />
              </div>

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
                    <button onClick={() => setActiveTab('accounts')}
                      className="px-6 py-3 rounded-xl text-white font-semibold text-sm shadow-md"
                      style={{ background:'linear-gradient(135deg,var(--color-primary),var(--color-secondary))', boxShadow:'0 4px 24px rgba(99,102,241,0.35)' }}>
                      <span className="flex items-center gap-2"><Wallet size={16}/> Adicionar Conta</span>
                    </button>
                    <button onClick={() => setShowImport(true)}
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
                          onClick={() => setChartPeriod('30d')}
                          className={`px-3 py-1.5 text-[10px] uppercase font-bold rounded-lg transition-all ${chartPeriod === '30d' ? 'bg-primary text-white shadow-lg' : 'text-textMuted hover:text-white'}`}
                        >
                          30 Dias
                        </button>
                        <button 
                          onClick={() => setChartPeriod('all')}
                          className={`px-3 py-1.5 text-[10px] uppercase font-bold rounded-lg transition-all ${chartPeriod === 'all' ? 'bg-primary text-white shadow-lg' : 'text-textMuted hover:text-white'}`}
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
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" vertical={false}/>
                          <XAxis 
                            dataKey="name" 
                            stroke="#6b7280" 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{ fontSize:10 }} 
                            interval={chartPeriod === '30d' ? 4 : 0}
                          />
                          <YAxis stroke="#6b7280" axisLine={false} tickLine={false} tick={{ fontSize:10 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`}/>
                          <RechartsTooltip 
                            contentStyle={{ backgroundColor:'#1c1c24', border:'1px solid rgba(255,255,255,0.1)', borderRadius:12 }}
                            formatter={(v: any) => [fmt(v), chartPeriod === '30d' ? 'Evolução' : 'Saldo']} 
                            labelStyle={{ color:'#9ca3af' }}
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
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" horizontal={false}/>
                            <XAxis type="number" hide/>
                            <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} stroke="#6b7280" tick={{ fontSize:11 }} width={80}/>
                            <RechartsTooltip cursor={{ fill:'rgba(255,255,255,0.03)' }}
                              contentStyle={{ backgroundColor:'#1c1c24', border:'1px solid rgba(255,255,255,0.1)', borderRadius:12 }}
                              formatter={(v: any) => [fmt(v),'Gasto']}/>
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
            </>
          )}

          {/* ══════════ TRANSACTIONS TAB ══════════ */}
          {activeTab === 'transactions' && (
            <>
              <div className="mb-6 flex justify-between items-end">
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
                      borderColor: txFilter === f.key ? f.border : 'rgba(255,255,255,0.08)',
                      color: txFilter === f.key ? f.text : '#9ca3af',
                      borderWidth: 1
                    }}>
                    {f.label}
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
              <AccountsManager 
                accounts={accounts} 
                onAdd={addAccount}
                onUpdate={updateAccount}
                onDelete={deleteAccount}
              />
            </>
          )}

          {/* ══════════ DEBTS TAB ══════════ */}
          {activeTab === 'debts' && (
            <>
              <div className="mb-6">
                <h1 className="text-3xl font-bold text-white mb-1">Dívidas e Parcelamentos</h1>
                <p className="text-textMuted text-sm">Controle de passivos a longo prazo</p>
              </div>
              <DebtManager 
                debts={debts} 
                onAdd={addDebt}
                onDelete={deleteDebt}
                accounts={accounts} 
              />
            </>
          )}
        </div>
      </main>

      {showImport && <ImportModal accounts={accounts} onClose={() => setShowImport(false)} onImport={handleImport} />}
    </div>
  );
}

/* --- UI Helpers --- */

function SummaryCard({ title, amount, icon, badge, isPositive, onClick }: any) {
  return (
    <div onClick={onClick} className={`glass-card rounded-2xl p-6 transition-all ${onClick ? 'cursor-pointer hover:bg-white/5 hover:-translate-y-1' : ''}`}>
      <div className="flex justify-between items-start mb-4">
        <div className="p-2.5 rounded-xl" style={{ backgroundColor:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.05)' }}>
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

function TxTable({ rows }: { rows: Transaction[] }) {
  return (
    <div className="overflow-x-auto min-h-[400px]">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-textMuted">
            <th className="pb-3 font-semibold w-24">Data</th>
            <th className="pb-3 font-semibold">Descrição</th>
            <th className="pb-3 font-semibold">Categoria</th>
            <th className="pb-3 font-semibold text-right">Valor</th>
          </tr>
        </thead>
        <tbody className="text-sm divide-y divide-white/5">
          {rows.map(t => (
            <tr key={t.id} className="group hover:bg-white/[0.02] transition-colors">
              <td className="py-4 text-textMuted">{new Date(t.date + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
              <td className="py-4 font-medium text-white">{t.name}</td>
              <td className="py-4">
                <span className="px-2.5 py-1 rounded-full text-xs border"
                  style={{
                    backgroundColor: CATEGORY_COLORS[t.category] ? `${CATEGORY_COLORS[t.category]}15` : 'rgba(255,255,255,0.05)',
                    borderColor: CATEGORY_COLORS[t.category] ? `${CATEGORY_COLORS[t.category]}30` : 'rgba(255,255,255,0.1)',
                    color: CATEGORY_COLORS[t.category] || '#9ca3af'
                  }}>
                  {t.category}
                </span>
              </td>
              <td className={`py-4 text-right font-bold ${t.amount >= 0 ? 'text-teal-400' : 'text-red-400'}`}>
                {t.amount >= 0 ? '+' : ''}{t.amount.toLocaleString('pt-BR', { minimumFractionDigits:2 })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NavItem({ icon, label, active, badge, badgeColor, onClick, isSubItem }: any) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all ${
        active ? 'bg-white/10 text-white shadow-sm' : 'text-textMuted hover:bg-white/5 hover:text-white'
      } ${isSubItem ? 'text-sm py-2' : ''}`}>
      <div className="flex items-center gap-3">
        <span className={active ? 'text-primary' : ''}>{icon}</span>
        <span className="font-medium">{label}</span>
      </div>
      {badge !== undefined && (
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: badgeColor || 'rgba(255,255,255,0.1)', color: badgeColor ? '#fff' : 'inherit' }}>
          {badge}
        </span>
      )}
    </button>
  );
}
