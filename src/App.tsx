import React, { useState } from 'react';
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
  Plus
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  BarChart, Bar
} from 'recharts';

const mockBalanceData = [
  { name: 'Jan', balance: 4000 },
  { name: 'Feb', balance: 3000 },
  { name: 'Mar', balance: 5000 },
  { name: 'Apr', balance: 4500 },
  { name: 'May', balance: 6000 },
  { name: 'Jun', balance: 5500 },
  { name: 'Jul', balance: 8000 },
];

const mockCategoryData = [
  { name: 'Moradia', amount: 2000 },
  { name: 'Alimentação', amount: 1200 },
  { name: 'Transporte', amount: 500 },
  { name: 'Lazer', amount: 800 },
];

const mockTransactions = [
  { id: 1, name: 'Supermercado', category: 'Alimentação', date: '2023-10-15', amount: -250.50 },
  { id: 2, name: 'Salário', category: 'Receita', date: '2023-10-05', amount: 8500.00 },
  { id: 3, name: 'Uber', category: 'Transporte', date: '2023-10-12', amount: -35.90 },
  { id: 4, name: 'Cinema', category: 'Lazer', date: '2023-10-14', amount: -60.00 },
  { id: 5, name: 'Aluguel', category: 'Moradia', date: '2023-10-10', amount: -1500.00 },
];

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <div className="flex h-screen bg-background overflow-hidden relative">
      {/* Background Decorative Elements */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-primary/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] bg-secondary/10 rounded-full blur-[120px] pointer-events-none" />
      
      {/* Sidebar */}
      <aside className="w-64 glass-panel border-r border-white/5 flex flex-col justify-between z-10 hidden md:flex">
        <div>
          <div className="p-6 flex items-center space-x-3 text-white">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-primary to-secondary flex items-center justify-center">
              <span className="font-bold text-lg leading-none">F</span>
            </div>
            <span className="text-xl font-bold tracking-wider">Antigravity<span className="text-primary font-light">Fin</span></span>
          </div>
          
          <nav className="mt-6 px-4 space-y-2">
            <NavItem icon={<LayoutDashboard size={20} />} label="Dashboard" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
            <NavItem icon={<Wallet size={20} />} label="Carteiras" />
            <NavItem icon={<ArrowRightLeft size={20} />} label="Transações" />
            <NavItem icon={<PieChart size={20} />} label="Relatórios" />
            <NavItem icon={<Settings size={20} />} label="Configurações" />
          </nav>
        </div>
        
        <div className="p-6">
          <div className="glass-card rounded-2xl p-4 flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-full bg-gradient-to-r from-green-400 to-accent flex items-center justify-center mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M15 9L12 12L9 9" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M15 15L12 12L9 15" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h4 className="text-sm font-semibold text-white">Integração Pluggy</h4>
            <p className="text-xs text-textMuted mt-1">Status: Aguardando Conexão</p>
            <button className="mt-4 w-full py-2 bg-white/10 hover:bg-white/20 transition-colors rounded-lg text-xs font-semibold text-white">
              Conectar Banco
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-y-auto z-10">
        {/* Topbar */}
        <header className="h-20 px-8 flex items-center justify-between border-b border-white/5 glass-panel sticky top-0 z-20">
          <div className="flex-1 flex items-center">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-textMuted" size={18} />
              <input 
                type="text" 
                placeholder="Buscar transação..." 
                className="w-full bg-dashboard/50 border border-white/5 rounded-full py-2 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-primary/50 transition-colors"
              />
            </div>
          </div>
          
          <div className="flex items-center space-x-6 relative">
            <button className="relative text-textMuted hover:text-white transition-colors">
              <Bell size={20} />
              <span className="absolute top-0 right-0 w-2 h-2 bg-primary rounded-full"></span>
            </button>
            <div className="flex items-center space-x-3 cursor-pointer">
              <img src="https://ui-avatars.com/api/?name=Vitor&background=6366f1&color=fff" alt="User Avatar" className="w-9 h-9 rounded-full border-2 border-primary/20" />
              <div className="hidden md:block">
                <p className="text-sm font-medium text-white">Vitor</p>
                <p className="text-xs text-textMuted">Pro User</p>
              </div>
            </div>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="flex-1 p-8">
          <div className="flex justify-between items-end mb-8">
            <div>
              <h1 className="text-3xl font-bold text-white mb-1">Visão Geral</h1>
              <p className="text-textMuted">Acompanhe suas finanças e controle seus gastos.</p>
            </div>
            <button className="flex items-center space-x-2 bg-primary hover:bg-primary/90 text-white px-5 py-2.5 rounded-xl font-medium transition-colors shadow-lg shadow-primary/20">
              <Plus size={18} />
              <span>Nova Transação</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {/* Summary Cards */}
            <SummaryCard 
              title="Saldo Atual" 
              amount="R$ 8.000,00" 
              trend="+12%" 
              isPositive={true} 
              icon={<Wallet className="text-primary" size={24} />} 
            />
            <SummaryCard 
              title="Receitas (Mês)" 
              amount="R$ 12.500,00" 
              trend="+5%" 
              isPositive={true} 
              icon={<ArrowUpRight className="text-accent" size={24} />} 
            />
            <SummaryCard 
              title="Despesas (Mês)" 
              amount="R$ 4.500,00" 
              trend="-2%" 
              isPositive={true} 
              icon={<ArrowDownRight className="text-red-400" size={24} />} 
              subtitle="Menos gastos é bom!"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            {/* Main Chart */}
            <div className="lg:col-span-2 glass-card rounded-2xl p-6">
              <h3 className="text-lg font-semibold text-white mb-6">Evolução do Saldo</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={mockBalanceData}>
                    <defs>
                      <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a35" vertical={false} />
                    <XAxis dataKey="name" stroke="#9ca3af" axisLine={false} tickLine={false} />
                    <YAxis stroke="#9ca3af" axisLine={false} tickLine={false} tickFormatter={(value) => \`R$\${value}\`} />
                    <RechartsTooltip 
                      contentStyle={{ backgroundColor: '#1c1c24', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                      itemStyle={{ color: '#fff' }}
                    />
                    <Area type="monotone" dataKey="balance" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#colorBalance)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Category Chart */}
            <div className="glass-card rounded-2xl p-6">
              <h3 className="text-lg font-semibold text-white mb-6">Gastos por Categoria</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={mockCategoryData} layout="vertical" margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a35" horizontal={false} />
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} stroke="#9ca3af" />
                    <RechartsTooltip 
                      cursor={{fill: 'rgba(255,255,255,0.05)'}}
                      contentStyle={{ backgroundColor: '#1c1c24', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                    />
                    <Bar dataKey="amount" fill="#a855f7" radius={[0, 4, 4, 0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Transactions Table */}
          <div className="glass-card rounded-2xl p-6 mb-8">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-semibold text-white">Últimas Transações</h3>
              <button className="text-sm text-primary hover:text-primary/80 transition-colors">Ver todas</button>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 text-xs text-textMuted uppercase tracking-wider">
                    <th className="pb-3 font-medium">Transação</th>
                    <th className="pb-3 font-medium">Categoria</th>
                    <th className="pb-3 font-medium">Data</th>
                    <th className="pb-3 font-medium text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {mockTransactions.map((tx) => (
                    <tr key={tx.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td className="py-4 text-sm text-white font-medium">{tx.name}</td>
                      <td className="py-4 text-sm">
                        <span className="inline-block px-3 py-1 rounded-full bg-white/5 text-textMuted text-xs border border-white/10">
                          {tx.category}
                        </span>
                      </td>
                      <td className="py-4 text-sm text-textMuted">{new Date(tx.date).toLocaleDateString('pt-BR')}</td>
                      <td className={\`py-4 text-sm font-semibold text-right \${tx.amount > 0 ? 'text-accent' : 'text-white'}\`}>
                        {tx.amount > 0 ? '+' : ''} R$ {Math.abs(tx.amount).toFixed(2).replace('.', ',')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}

function NavItem({ icon, label, active = false, onClick = () => {} }) {
  return (
    <button 
      onClick={onClick}
      className={\`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 \${
        active 
          ? 'bg-primary/10 text-primary border border-primary/20' 
          : 'text-textMuted hover:bg-white/5 hover:text-white'
      }\`}
    >
      {icon}
      <span className="font-medium text-sm">{label}</span>
      {active && <div className="ml-auto w-1 h-5 bg-primary rounded-full shadow-[0_0_8px_rgba(99,102,241,0.8)]" />}
    </button>
  );
}

function SummaryCard({ title, amount, trend, isPositive, icon, subtitle }) {
  return (
    <div className="glass-card rounded-2xl p-6 relative overflow-hidden group hover:-translate-y-1 transition-transform duration-300">
      <div className="flex justify-between items-start mb-4 relative z-10">
        <div>
          <p className="text-sm font-medium text-textMuted mb-1">{title}</p>
          <h2 className="text-2xl font-bold text-white">{amount}</h2>
        </div>
        <div className="p-3 bg-white/5 rounded-xl border border-white/10">
          {icon}
        </div>
      </div>
      <div className="flex items-center space-x-2 relative z-10">
        <span className={\`text-xs font-semibold px-2 py-1 rounded-md \${isPositive ? 'bg-accent/20 text-accent' : 'bg-red-400/20 text-red-400'}\`}>
          {trend}
        </span>
        <span className="text-xs text-textMuted">{subtitle || 'em relação ao mês passado'}</span>
      </div>
      {/* Decorative gradient orb */}
      <div className="absolute -bottom-8 -right-8 w-32 h-32 bg-white/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-colors duration-500" />
    </div>
  );
}

export default App;
