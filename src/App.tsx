import { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard,
  Wallet,
  ArrowRightLeft,
  PieChart,
  Settings,
  Bell,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  Upload,
  Trash2,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from 'recharts';
import { ImportModal } from './components/ImportModal';
import type { Transaction } from './utils/parsers';

const STORAGE_KEY = 'finance_transactions';

const CATEGORY_COLORS: Record<string, string> = {
  'Alimentação': '#f59e0b',
  'Transporte': '#3b82f6',
  'Lazer': '#a855f7',
  'Moradia': '#6366f1',
  'Saúde': '#10b981',
  'Educação': '#06b6d4',
  'Compras': '#ec4899',
  'Receita': '#14b8a6',
  'Outros': '#6b7280',
};

function fmt(value: number) {
  return `R$ ${Math.abs(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showImport, setShowImport] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
  }, [transactions]);

  const handleImport = (newTxs: Transaction[]) => {
    setTransactions(prev => {
      const existingIds = new Set(prev.map(t => t.id));
      const unique = newTxs.filter(t => !existingIds.has(t.id));
      return [...prev, ...unique].sort((a, b) => b.date.localeCompare(a.date));
    });
  };

  const handleClearAll = () => {
    if (confirm('Remover todas as transações importadas?')) {
      setTransactions([]);
    }
  };

  // Derived stats
  const { totalBalance, totalIncome, totalExpense, balanceByMonth, expenseByCategory, filtered } = useMemo(() => {
    const totalIncome = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const totalExpense = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    const totalBalance = totalIncome - totalExpense;

    const monthMap: Record<string, number> = {};
    for (const tx of transactions) {
      const month = tx.date.substring(0, 7);
      monthMap[month] = (monthMap[month] || 0) + tx.amount;
    }
    const balanceByMonth = Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-7)
      .map(([key, balance]) => ({
        name: new Date(key + '-15').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
        balance: parseFloat(balance.toFixed(2)),
      }));

    const catMap: Record<string, number> = {};
    for (const tx of transactions.filter(t => t.amount < 0)) {
      catMap[tx.category] = (catMap[tx.category] || 0) + Math.abs(tx.amount);
    }
    const expenseByCategory = Object.entries(catMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([name, amount]) => ({ name, amount: parseFloat(amount.toFixed(2)) }));

    const lower = searchTerm.toLowerCase();
    const filtered = transactions.filter(t =>
      t.name.toLowerCase().includes(lower) ||
      t.category.toLowerCase().includes(lower)
    );

    return { totalBalance, totalIncome, totalExpense, balanceByMonth, expenseByCategory, filtered };
  }, [transactions, searchTerm]);

  const isEmpty = transactions.length === 0;

  return (
    <div className="flex h-screen overflow-hidden relative" style={{ backgroundColor: 'var(--color-background)' }}>
      {/* Decorative blobs */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 rounded-full blur-[100px] pointer-events-none" style={{ backgroundColor: 'rgba(99,102,241,0.15)' }} />
      <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none" style={{ backgroundColor: 'rgba(168,85,247,0.08)' }} />

      {/* Sidebar */}
      <aside className="w-64 glass-panel border-r border-white/5 hidden md:flex flex-col justify-between z-10">
        <div>
          <div className="p-6 flex items-center space-x-3 text-white">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-lg" style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))' }}>F</div>
            <span className="text-xl font-bold tracking-wide">Fin<span style={{ color: 'var(--color-primary)', fontWeight: 300 }}>Flow</span></span>
          </div>
          <nav className="mt-6 px-4 space-y-1">
            <NavItem icon={<LayoutDashboard size={18} />} label="Dashboard" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
            <NavItem icon={<ArrowRightLeft size={18} />} label="Transações" active={activeTab === 'transactions'} onClick={() => setActiveTab('transactions')} />
            <NavItem icon={<PieChart size={18} />} label="Relatórios" />
            <NavItem icon={<Wallet size={18} />} label="Carteiras" />
            <NavItem icon={<Settings size={18} />} label="Configurações" />
          </nav>
        </div>

        {/* Import Button in sidebar */}
        <div className="p-6">
          <button
            onClick={() => setShowImport(true)}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all"
            style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))', boxShadow: '0 4px 20px rgba(99,102,241,0.3)' }}
          >
            <Upload size={16} />
            Importar Extrato
          </button>
          {transactions.length > 0 && (
            <button onClick={handleClearAll} className="w-full mt-2 py-2 text-xs text-textMuted hover:text-red-400 flex items-center justify-center gap-1 transition-colors">
              <Trash2 size={12} /> Limpar dados
            </button>
          )}
          <p className="text-center text-xs text-textMuted mt-3">{transactions.length} transações carregadas</p>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col h-screen overflow-y-auto z-10">
        {/* Topbar */}
        <header className="h-20 px-8 flex items-center justify-between border-b border-white/5 glass-panel sticky top-0 z-20">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" size={16} />
            <input
              type="text"
              placeholder="Buscar transação ou categoria..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full border rounded-full py-2 pl-9 pr-4 text-sm text-white focus:outline-none transition-colors"
              style={{ backgroundColor: 'rgba(18,18,26,0.5)', borderColor: 'rgba(255,255,255,0.06)' }}
            />
          </div>

          <div className="flex items-center space-x-5">
            <button className="relative text-textMuted hover:text-white transition-colors">
              <Bell size={20} />
              {transactions.length > 0 && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--color-primary)' }} />}
            </button>
            <div className="flex items-center space-x-3 cursor-pointer">
              <img src="https://ui-avatars.com/api/?name=Vitor&background=6366f1&color=fff" alt="Avatar" className="w-9 h-9 rounded-full border-2" style={{ borderColor: 'rgba(99,102,241,0.3)' }} />
              <div className="hidden md:block">
                <p className="text-sm font-medium text-white">Vitor</p>
                <p className="text-xs text-textMuted">Conta Pessoal</p>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 p-8">
          {/* Page header */}
          <div className="flex justify-between items-end mb-8">
            <div>
              <h1 className="text-3xl font-bold text-white mb-1">
                {activeTab === 'dashboard' ? 'Visão Geral' : 'Transações'}
              </h1>
              <p className="text-textMuted text-sm">
                {isEmpty ? 'Importe um extrato bancário para começar' : `Baseado em ${transactions.length} transações importadas`}
              </p>
            </div>
            <button
              onClick={() => setShowImport(true)}
              className="md:hidden flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-white font-medium"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              <Upload size={16} /> Importar
            </button>
          </div>

          {isEmpty ? (
            /* Empty state */
            <div className="glass-card rounded-2xl p-16 flex flex-col items-center text-center">
              <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-6" style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(168,85,247,0.2))', border: '1px solid rgba(99,102,241,0.2)' }}>
                <Upload size={36} style={{ color: 'var(--color-primary)' }} />
              </div>
              <h2 className="text-2xl font-bold text-white mb-3">Nenhum dado ainda</h2>
              <p className="text-textMuted max-w-md mb-8">
                Exporte o extrato do seu banco no formato <strong className="text-white">.OFX</strong> (Itaú, Bradesco, BB, Santander) ou <strong className="text-white">.CSV</strong> (Nubank, Inter) e importe aqui. Seus gastos aparecerão automaticamente nos gráficos.
              </p>
              <button
                onClick={() => setShowImport(true)}
                className="px-8 py-3 rounded-xl text-white font-semibold text-sm transition-all shadow-lg"
                style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))', boxShadow: '0 4px 24px rgba(99,102,241,0.4)' }}
              >
                <span className="flex items-center gap-2"><Upload size={18} /> Importar primeiro extrato</span>
              </button>
            </div>
          ) : (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <SummaryCard
                  title="Saldo Total"
                  amount={fmt(totalBalance)}
                  isPositive={totalBalance >= 0}
                  icon={<Wallet size={22} style={{ color: 'var(--color-primary)' }} />}
                  badge={totalBalance >= 0 ? 'Positivo' : 'Negativo'}
                />
                <SummaryCard
                  title="Total de Receitas"
                  amount={fmt(totalIncome)}
                  isPositive={true}
                  icon={<ArrowUpRight size={22} style={{ color: 'var(--color-accent)' }} />}
                  badge={`${transactions.filter(t => t.amount > 0).length} entradas`}
                />
                <SummaryCard
                  title="Total de Despesas"
                  amount={fmt(totalExpense)}
                  isPositive={false}
                  icon={<ArrowDownRight size={22} className="text-red-400" />}
                  badge={`${transactions.filter(t => t.amount < 0).length} saídas`}
                />
              </div>

              {/* Charts */}
              {balanceByMonth.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                  <div className="lg:col-span-2 glass-card rounded-2xl p-6">
                    <h3 className="text-lg font-semibold text-white mb-6">Fluxo Mensal</h3>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={balanceByMonth}>
                          <defs>
                            <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" vertical={false} />
                          <XAxis dataKey="name" stroke="#6b7280" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                          <YAxis stroke="#6b7280" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
                          <RechartsTooltip
                            contentStyle={{ backgroundColor: '#1c1c24', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 }}
                            formatter={(v: number) => [fmt(v), 'Saldo']}
                            labelStyle={{ color: '#9ca3af' }}
                          />
                          <Area type="monotone" dataKey="balance" stroke="#6366f1" strokeWidth={2.5} fill="url(#colorBalance)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {expenseByCategory.length > 0 && (
                    <div className="glass-card rounded-2xl p-6">
                      <h3 className="text-lg font-semibold text-white mb-6">Gastos por Categoria</h3>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={expenseByCategory} layout="vertical" margin={{ left: -10, right: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" horizontal={false} />
                            <XAxis type="number" hide />
                            <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} stroke="#6b7280" tick={{ fontSize: 11 }} width={80} />
                            <RechartsTooltip
                              cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                              contentStyle={{ backgroundColor: '#1c1c24', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 }}
                              formatter={(v: number) => [fmt(v), 'Gasto']}
                            />
                            <Bar dataKey="amount" radius={[0, 4, 4, 0]} barSize={16}>
                              {expenseByCategory.map((entry) => (
                                <Cell key={entry.name} fill={CATEGORY_COLORS[entry.name] || '#6366f1'} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Transactions table */}
              <div className="glass-card rounded-2xl p-6">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-semibold text-white">
                    {searchTerm ? `Resultados para "${searchTerm}"` : 'Transações Recentes'}
                  </h3>
                  <span className="text-xs text-textMuted">{filtered.length} registros</span>
                </div>
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
                      {filtered.slice(0, 50).map(tx => (
                        <tr key={tx.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                          <td className="py-3 text-sm text-white font-medium max-w-[240px] truncate pr-4">{tx.name}</td>
                          <td className="py-3 text-sm">
                            <span
                              className="inline-block px-2.5 py-1 rounded-full text-xs border border-white/10"
                              style={{ backgroundColor: `${CATEGORY_COLORS[tx.category] || '#6366f1'}15`, color: CATEGORY_COLORS[tx.category] || '#6366f1' }}
                            >
                              {tx.category}
                            </span>
                          </td>
                          <td className="py-3 text-xs text-textMuted">{new Date(tx.date + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
                          <td className={`py-3 text-sm font-semibold text-right ${tx.amount > 0 ? 'text-accent' : 'text-white'}`}>
                            {tx.amount > 0 ? '+' : ''}{fmt(tx.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filtered.length === 0 && (
                    <p className="text-center text-textMuted py-8 text-sm">Nenhuma transação encontrada.</p>
                  )}
                  {filtered.length > 50 && (
                    <p className="text-center text-xs text-textMuted py-4">Mostrando 50 de {filtered.length} — use a busca para filtrar</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      {showImport && (
        <ImportModal onClose={() => setShowImport(false)} onImport={handleImport} />
      )}
    </div>
  );
}

function NavItem({ icon, label, active = false, onClick = () => {} }: { icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center space-x-3 px-4 py-2.5 rounded-xl transition-all duration-200 text-sm"
      style={{
        backgroundColor: active ? 'rgba(99,102,241,0.1)' : 'transparent',
        color: active ? 'var(--color-primary)' : 'var(--color-textMuted)',
        border: active ? '1px solid rgba(99,102,241,0.2)' : '1px solid transparent',
      }}
    >
      {icon}
      <span className="font-medium">{label}</span>
      {active && <div className="ml-auto w-1 h-4 rounded-full" style={{ backgroundColor: 'var(--color-primary)', boxShadow: '0 0 8px rgba(99,102,241,0.8)' }} />}
    </button>
  );
}

function SummaryCard({ title, amount, isPositive, icon, badge }: { title: string; amount: string; isPositive: boolean; icon: React.ReactNode; badge: string }) {
  return (
    <div className="glass-card rounded-2xl p-6 relative overflow-hidden group hover:-translate-y-0.5 transition-transform duration-300 cursor-default">
      <div className="flex justify-between items-start mb-4 relative z-10">
        <div>
          <p className="text-xs font-medium text-textMuted mb-1.5 uppercase tracking-wide">{title}</p>
          <h2 className="text-2xl font-bold text-white">{amount}</h2>
        </div>
        <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}>
          {icon}
        </div>
      </div>
      <span
        className="text-xs font-semibold px-2.5 py-1 rounded-lg relative z-10"
        style={{
          backgroundColor: isPositive ? 'rgba(20,184,166,0.15)' : 'rgba(239,68,68,0.12)',
          color: isPositive ? 'var(--color-accent)' : '#f87171',
        }}
      >
        {badge}
      </span>
      <div className="absolute -bottom-8 -right-8 w-32 h-32 rounded-full blur-2xl transition-colors duration-500 group-hover:opacity-80" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }} />
    </div>
  );
}
