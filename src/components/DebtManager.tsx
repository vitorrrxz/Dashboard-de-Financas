import { useState } from 'react';
import { X, Plus, Trash2, Edit2, TrendingDown, AlertCircle, CheckCircle } from 'lucide-react';
import type { Debt, DebtCategory } from '../types';

const CATEGORY_COLORS: Record<DebtCategory, string> = {
  'Empréstimo':        '#f59e0b',
  'Financiamento':     '#3b82f6',
  'Cartão de Crédito': '#ec4899',
  'Pessoal':           '#a855f7',
  'Outros':            '#6b7280',
};

const DEBT_CATEGORIES: DebtCategory[] = ['Empréstimo', 'Financiamento', 'Cartão de Crédito', 'Pessoal', 'Outros'];

const EMPTY_DEBT: Omit<Debt, 'id' | 'createdAt' | 'paidAmount' | 'paidInstallments'> = {
  name: '',
  description: '',
  category: 'Empréstimo',
  totalAmount: 0,
  monthlyPayment: 0,
  totalInstallments: 1,
  nextDueDate: new Date().toISOString().slice(0, 10),
  interestRate: 0,
};

interface DebtManagerProps {
  debts: Debt[];
  onChange: (debts: Debt[]) => void;
}

export function DebtManager({ debts, onChange }: DebtManagerProps) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Debt | null>(null);
  const [form, setForm] = useState<Omit<Debt, 'id' | 'createdAt' | 'paidAmount' | 'paidInstallments'>>(EMPTY_DEBT);

  const totalDebt = debts.reduce((s, d) => s + (d.totalAmount - d.paidAmount), 0);
  const totalMonthly = debts.reduce((s, d) => s + d.monthlyPayment, 0);

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_DEBT);
    setShowForm(true);
  };

  const openEdit = (debt: Debt) => {
    setEditing(debt);
    setForm({
      name: debt.name,
      description: debt.description ?? '',
      category: debt.category,
      totalAmount: debt.totalAmount,
      monthlyPayment: debt.monthlyPayment,
      totalInstallments: debt.totalInstallments,
      nextDueDate: debt.nextDueDate,
      interestRate: debt.interestRate,
    });
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.name.trim() || form.totalAmount <= 0) return;
    if (editing) {
      onChange(debts.map(d => d.id === editing.id ? {
        ...editing,
        ...form,
        totalAmount: form.totalAmount,
      } : d));
    } else {
      const newDebt: Debt = {
        ...form,
        id: `debt-${Date.now()}`,
        paidAmount: 0,
        paidInstallments: 0,
        createdAt: new Date().toISOString(),
      };
      onChange([...debts, newDebt]);
    }
    setShowForm(false);
  };

  const handlePayInstallment = (debt: Debt) => {
    if (debt.paidInstallments >= debt.totalInstallments) return;
    onChange(debts.map(d => d.id === debt.id ? {
      ...d,
      paidInstallments: d.paidInstallments + 1,
      paidAmount: d.paidAmount + d.monthlyPayment,
    } : d));
  };

  const handleDelete = (id: string) => {
    if (confirm('Remover esta dívida?')) onChange(debts.filter(d => d.id !== id));
  };

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  const remaining = (d: Debt) => Math.max(0, d.totalAmount - d.paidAmount);
  const progress = (d: Debt) => d.totalInstallments > 0 ? (d.paidInstallments / d.totalInstallments) * 100 : 0;
  const isPaid = (d: Debt) => d.paidInstallments >= d.totalInstallments;
  const isOverdue = (d: Debt) => !isPaid(d) && new Date(d.nextDueDate) < new Date();

  return (
    <div>
      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="glass-card rounded-2xl p-5">
          <p className="text-xs text-textMuted uppercase tracking-wide mb-1">Total em Dívidas</p>
          <p className="text-2xl font-bold text-red-400">
            R$ {totalDebt.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-textMuted mt-1">{debts.filter(d => !isPaid(d)).length} dívida(s) ativas</p>
        </div>
        <div className="glass-card rounded-2xl p-5">
          <p className="text-xs text-textMuted uppercase tracking-wide mb-1">Parcelas Mensais</p>
          <p className="text-2xl font-bold text-amber-400">
            R$ {totalMonthly.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-textMuted mt-1">por mês</p>
        </div>
      </div>

      {/* Debt Cards */}
      <div className="space-y-4 mb-4">
        {debts.length === 0 && (
          <div className="glass-card rounded-xl p-10 flex flex-col items-center text-center">
            <TrendingDown size={32} className="text-textMuted mb-3" />
            <p className="text-white font-medium mb-1">Nenhuma dívida cadastrada</p>
            <p className="text-textMuted text-sm">Adicione empréstimos, financiamentos ou outras dívidas</p>
          </div>
        )}

        {debts.map(debt => {
          const pct = progress(debt);
          const paid = isPaid(debt);
          const overdue = isOverdue(debt);
          const color = CATEGORY_COLORS[debt.category];

          return (
            <div key={debt.id} className="glass-card rounded-xl p-5" style={{ borderLeft: `3px solid ${color}` }}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-semibold text-white">{debt.name}</h4>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: `${color}20`, color }}>
                      {debt.category}
                    </span>
                    {paid && <span className="text-xs px-2 py-0.5 rounded-full bg-accent/20 text-accent flex items-center gap-1"><CheckCircle size={10} /> Quitada</span>}
                    {overdue && <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 flex items-center gap-1"><AlertCircle size={10} /> Vencida</span>}
                  </div>
                  {debt.description && <p className="text-xs text-textMuted mt-0.5">{debt.description}</p>}
                </div>
                <div className="flex gap-1 shrink-0">
                  {!paid && (
                    <button onClick={() => handlePayInstallment(debt)}
                      title="Marcar parcela como paga"
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                      style={{ backgroundColor: 'rgba(20,184,166,0.1)', color: '#14b8a6', border: '1px solid rgba(20,184,166,0.2)' }}>
                      + Pagar parcela
                    </button>
                  )}
                  <button onClick={() => openEdit(debt)} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-textMuted hover:text-white">
                    <Edit2 size={13} />
                  </button>
                  <button onClick={() => handleDelete(debt.id)} className="p-2 hover:bg-red-500/10 rounded-lg transition-colors text-textMuted hover:text-red-400">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="mb-3">
                <div className="flex justify-between text-xs text-textMuted mb-1.5">
                  <span>{debt.paidInstallments}/{debt.totalInstallments} parcelas pagas</span>
                  <span>{pct.toFixed(0)}%</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.07)' }}>
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: paid ? '#14b8a6' : color }} />
                </div>
              </div>

              {/* Financial Info */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg p-2.5" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
                  <p className="text-xs text-textMuted mb-0.5">Restante</p>
                  <p className="text-sm font-bold text-white">R$ {remaining(debt).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="rounded-lg p-2.5" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
                  <p className="text-xs text-textMuted mb-0.5">Parcela</p>
                  <p className="text-sm font-bold" style={{ color }}>R$ {debt.monthlyPayment.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="rounded-lg p-2.5" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
                  <p className="text-xs text-textMuted mb-0.5">Próx. Venc.</p>
                  <p className={`text-sm font-bold ${overdue ? 'text-red-400' : 'text-white'}`}>
                    {paid ? '—' : new Date(debt.nextDueDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={openAdd}
        className="w-full py-3 rounded-xl border border-dashed border-white/10 hover:border-red-400/40 text-textMuted hover:text-white text-sm flex items-center justify-center gap-2 transition-all">
        <Plus size={16} /> Adicionar Dívida
      </button>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md glass-card rounded-2xl p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-bold text-white">{editing ? 'Editar Dívida' : 'Nova Dívida'}</h3>
              <button onClick={() => setShowForm(false)} className="p-2 hover:bg-white/10 rounded-lg text-textMuted hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <FormField label="Nome da Dívida">
                <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ex: Empréstimo Banco do Brasil" className="input-field" />
              </FormField>

              <FormField label="Descrição (opcional)">
                <input value={form.description} onChange={e => set('description', e.target.value)} placeholder="Detalhes adicionais..." className="input-field" />
              </FormField>

              <FormField label="Categoria">
                <select value={form.category} onChange={e => set('category', e.target.value as DebtCategory)} className="input-field">
                  {DEBT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </FormField>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Valor Total (R$)">
                  <input type="number" step="0.01" value={form.totalAmount || ''} onChange={e => set('totalAmount', parseFloat(e.target.value) || 0)} placeholder="10000.00" className="input-field" />
                </FormField>
                <FormField label="Parcela Mensal (R$)">
                  <input type="number" step="0.01" value={form.monthlyPayment || ''} onChange={e => set('monthlyPayment', parseFloat(e.target.value) || 0)} placeholder="500.00" className="input-field" />
                </FormField>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Nº Total de Parcelas">
                  <input type="number" min={1} value={form.totalInstallments || ''} onChange={e => set('totalInstallments', parseInt(e.target.value) || 1)} placeholder="24" className="input-field" />
                </FormField>
                <FormField label="Juros (% ao mês)">
                  <input type="number" step="0.01" value={form.interestRate || ''} onChange={e => set('interestRate', parseFloat(e.target.value) || 0)} placeholder="2.5" className="input-field" />
                </FormField>
              </div>

              <FormField label="Próximo Vencimento">
                <input type="date" value={form.nextDueDate} onChange={e => set('nextDueDate', e.target.value)} className="input-field" />
              </FormField>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-xl text-sm text-textMuted border border-white/10 hover:bg-white/5 transition-colors">Cancelar</button>
              <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl text-sm text-white font-semibold transition-colors"
                style={{ background: 'linear-gradient(135deg, #f59e0b, #ec4899)' }}>
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
