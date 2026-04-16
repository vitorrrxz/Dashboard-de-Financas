import { useState } from 'react';
import { X, Plus, Trash2, Edit2, CreditCard, Landmark, PiggyBank, TrendingUp, Wallet, AlertCircle } from 'lucide-react';
import type { Account, AccountType } from '../types';

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking:   'Conta Corrente',
  savings:    'Poupança',
  credit:     'Cartão de Crédito',
  investment: 'Investimento',
  cash:       'Dinheiro em Espécie',
};

const ACCOUNT_TYPE_ICONS: Record<AccountType, React.ReactNode> = {
  checking:   <Landmark size={18} />,
  savings:    <PiggyBank size={18} />,
  credit:     <CreditCard size={18} />,
  investment: <TrendingUp size={18} />,
  cash:       <Wallet size={18} />,
};

const PRESET_COLORS = [
  '#6366f1','#a855f7','#14b8a6','#f59e0b','#ec4899','#3b82f6','#10b981','#f97316',
];

const EMPTY_ACCOUNT: Omit<Account, 'id' | 'createdAt'> = {
  name: '', bank: '', type: 'checking', balance: 0, color: '#6366f1',
};

interface AccountsManagerProps {
  accounts: Account[];
  onChange: (accounts: Account[]) => void;
}

export function AccountsManager({ accounts, onChange }: AccountsManagerProps) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form, setForm] = useState<Omit<Account, 'id'>>(EMPTY_ACCOUNT as Omit<Account, 'id'>);

  const totalBalance = accounts
    .filter(a => a.type !== 'credit')
    .reduce((s, a) => s + a.balance, 0);

  const totalCredit = accounts
    .filter(a => a.type === 'credit')
    .reduce((s, a) => s + (a.pendingBill ?? 0), 0);

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_ACCOUNT as Omit<Account, 'id'>);
    setShowForm(true);
  };

  const openEdit = (acc: Account) => {
    setEditing(acc);
    setForm({ ...acc });
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.name.trim()) return;
    if (editing) {
      onChange(accounts.map(a => a.id === editing.id ? { ...form, id: editing.id } : a));
    } else {
      onChange([...accounts, { ...form, id: `acc-${Date.now()}` }]);
    }
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    if (confirm('Remover esta conta?')) onChange(accounts.filter(a => a.id !== id));
  };

  const set = (k: keyof Omit<Account, 'id'>, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div>
      {/* Summary Strip */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="glass-card rounded-2xl p-5">
          <p className="text-xs text-textMuted uppercase tracking-wide mb-1">Saldo Real Total</p>
          <p className={`text-2xl font-bold ${totalBalance >= 0 ? 'text-white' : 'text-red-400'}`}>
            R$ {Math.abs(totalBalance).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-textMuted mt-1">{accounts.filter(a => a.type !== 'credit').length} conta(s)</p>
        </div>
        <div className="glass-card rounded-2xl p-5">
          <p className="text-xs text-textMuted uppercase tracking-wide mb-1">Faturas Pendentes (Cartão)</p>
          <p className="text-2xl font-bold text-red-400">
            R$ {totalCredit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-textMuted mt-1">{accounts.filter(a => a.type === 'credit').length} cartão(ões)</p>
        </div>
      </div>

      {/* Account Cards */}
      <div className="space-y-3 mb-4">
        {accounts.length === 0 && (
          <div className="glass-card rounded-xl p-8 flex flex-col items-center text-center">
            <Landmark size={32} className="text-textMuted mb-3" />
            <p className="text-white font-medium mb-1">Nenhuma conta cadastrada</p>
            <p className="text-textMuted text-sm">Adicione suas contas e cartões para ver seu saldo real</p>
          </div>
        )}
        {accounts.map(acc => (
          <div key={acc.id} className="glass-card rounded-xl p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-white"
              style={{ backgroundColor: `${acc.color}25`, border: `1px solid ${acc.color}40`, color: acc.color }}>
              {ACCOUNT_TYPE_ICONS[acc.type]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-white truncate">{acc.name}</p>
                <span className="text-xs px-2 py-0.5 rounded-full text-textMuted" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  {acc.bank}
                </span>
              </div>
              <p className="text-xs text-textMuted">{ACCOUNT_TYPE_LABELS[acc.type]}</p>
              {acc.type === 'credit' && acc.limit && (
                <div className="mt-2">
                  <div className="flex justify-between text-xs text-textMuted mb-1">
                    <span>Fatura: R$ {(acc.pendingBill ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                    <span>Limite: R$ {acc.limit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
                    <div className="h-full rounded-full bg-red-400 transition-all"
                      style={{ width: `${Math.min(100, ((acc.pendingBill ?? 0) / acc.limit) * 100)}%` }} />
                  </div>
                </div>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className={`text-lg font-bold ${acc.type === 'credit' ? 'text-red-400' : (acc.balance >= 0 ? 'text-white' : 'text-red-400')}`}>
                {acc.type === 'credit' ? '-' : ''}R$ {Math.abs(acc.type === 'credit' ? (acc.pendingBill ?? 0) : acc.balance).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
              {acc.type === 'credit' && acc.dueDay && (
                <p className="text-xs text-textMuted">Vence dia {acc.dueDay}</p>
              )}
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => openEdit(acc)} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-textMuted hover:text-white">
                <Edit2 size={14} />
              </button>
              <button onClick={() => handleDelete(acc.id)} className="p-2 hover:bg-red-500/10 rounded-lg transition-colors text-textMuted hover:text-red-400">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <button onClick={openAdd}
        className="w-full py-3 rounded-xl border border-dashed border-white/10 hover:border-primary/40 text-textMuted hover:text-white text-sm flex items-center justify-center gap-2 transition-all">
        <Plus size={16} /> Adicionar Conta ou Cartão
      </button>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md glass-card rounded-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-bold text-white">{editing ? 'Editar Conta' : 'Nova Conta'}</h3>
              <button onClick={() => setShowForm(false)} className="p-2 hover:bg-white/10 rounded-lg text-textMuted hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Nome da Conta">
                  <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ex: Conta Nubank" className="input-field" />
                </FormField>
                <FormField label="Banco / Operadora">
                  <input value={form.bank} onChange={e => set('bank', e.target.value)} placeholder="Ex: Nubank" className="input-field" />
                </FormField>
              </div>

              <FormField label="Tipo">
                <select value={form.type} onChange={e => set('type', e.target.value as AccountType)} className="input-field">
                  {(Object.entries(ACCOUNT_TYPE_LABELS) as [AccountType, string][]).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </FormField>

              {form.type === 'credit' ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Limite do Cartão (R$)">
                      <input type="number" value={form.limit ?? ''} onChange={e => set('limit', parseFloat(e.target.value) || 0)} placeholder="5000.00" className="input-field" />
                    </FormField>
                    <FormField label="Fatura Pendente (R$)">
                      <input type="number" value={form.pendingBill ?? ''} onChange={e => set('pendingBill', parseFloat(e.target.value) || 0)} placeholder="0.00" className="input-field" />
                    </FormField>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Dia de Fechamento">
                      <input type="number" min={1} max={31} value={form.closingDay ?? ''} onChange={e => set('closingDay', parseInt(e.target.value) || undefined)} placeholder="15" className="input-field" />
                    </FormField>
                    <FormField label="Dia de Vencimento">
                      <input type="number" min={1} max={31} value={form.dueDay ?? ''} onChange={e => set('dueDay', parseInt(e.target.value) || undefined)} placeholder="25" className="input-field" />
                    </FormField>
                  </div>
                </>
              ) : (
                <FormField label="Saldo Atual (R$)">
                  <input type="number" step="0.01" value={form.balance} onChange={e => set('balance', parseFloat(e.target.value) || 0)} placeholder="0.00" className="input-field" />
                </FormField>
              )}

              <FormField label="Cor">
                <div className="flex gap-2 flex-wrap">
                  {PRESET_COLORS.map(c => (
                    <button key={c} onClick={() => set('color', c)}
                      className="w-7 h-7 rounded-lg border-2 transition-transform hover:scale-110"
                      style={{ backgroundColor: c, borderColor: form.color === c ? '#fff' : 'transparent' }} />
                  ))}
                </div>
              </FormField>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-xl text-sm text-textMuted border border-white/10 hover:bg-white/5 transition-colors">Cancelar</button>
              <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl text-sm text-white font-semibold transition-colors"
                style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))' }}>
                {editing ? 'Salvar' : 'Adicionar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-textMuted mb-1.5 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}
