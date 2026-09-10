import { useState } from 'react';
import { X, Plus, Trash2, Edit2, Repeat, Pause, Play } from 'lucide-react';
import type { Account, RecurrenceFrequency, RecurringTransaction } from '../types';
import { CATEGORY_COLORS, EXPENSE_CATEGORIES } from '../utils/categories';
import { todayISO } from '../utils/debts';
import { formatDateBR } from '../utils/dates';
import { FormField } from './shared/FormField';

type RecurringFormData = Omit<RecurringTransaction, 'id' | 'createdAt'>;

/** Rótulos em português das frequências suportadas (ver `RecurrenceFrequency` em utils/dates.ts). */
const FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  weekly: 'Semanal',
  monthly: 'Mensal',
  yearly: 'Anual',
};

const EMPTY_RECURRING: RecurringFormData = {
  name: '', category: EXPENSE_CATEGORIES[0], amount: 0,
  frequency: 'monthly', nextOccurrence: '', active: true,
};

interface RecurringManagerProps {
  recurring: RecurringTransaction[];
  accounts: Account[];
  onAdd: (recurring: RecurringFormData) => Promise<void>;
  onUpdate: (id: string, recurring: Partial<RecurringFormData>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** Categorias vindas das transações reais, além das curadas — mesmo motivo de BudgetManager. */
  transactionCategories: string[];
}

/**
 * Aba "Recorrências" (FIN-056) — cadastro das transações que se repetem (salário, aluguel,
 * assinaturas). Não lança nada por conta própria: quem gera as `Transaction` reais é o
 * endpoint `/api/recurring-transactions/process`, disparado no carregamento do app (FIN-055).
 */
export function RecurringManager({ recurring, accounts, onAdd, onUpdate, onDelete, transactionCategories }: RecurringManagerProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RecurringFormData>(EMPTY_RECURRING);

  // O valor é digitado sempre positivo; o sinal vem deste seletor (mesma convenção de
  // `Transaction.amount`: negativo = despesa). Sem isso, o usuário teria que digitar "-350".
  const [kind, setKind] = useState<'expense' | 'income'>('expense');

  // Ao contrário do orçamento (só despesas), uma recorrência pode ser receita — por isso a
  // lista usa TODAS as categorias conhecidas, e não `EXPENSE_CATEGORIES`: sem "Receita"
  // disponível, não daria para categorizar um salário recorrente.
  const categories = Array.from(new Set([...Object.keys(CATEGORY_COLORS), ...transactionCategories]));

  /** Abre o modal em modo "criar", com a próxima ocorrência sugerida para hoje. */
  const openAdd = () => {
    setEditingId(null);
    setKind('expense');
    setForm({ ...EMPTY_RECURRING, nextOccurrence: todayISO() });
    setShowForm(true);
  };

  /** Abre o modal em modo "editar", pré-preenchido com os dados da recorrência. */
  const openEdit = (rec: RecurringTransaction) => {
    setEditingId(rec.id);
    setKind(rec.amount < 0 ? 'expense' : 'income');
    setForm({
      name: rec.name,
      category: rec.category,
      amount: Math.abs(rec.amount),
      frequency: rec.frequency,
      nextOccurrence: rec.nextOccurrence,
      active: rec.active,
      accountId: rec.accountId,
    });
    setShowForm(true);
  };

  /** Envia o formulário, aplicando o sinal do valor conforme despesa/receita. */
  const handleSave = async () => {
    if (!form.name.trim() || form.amount <= 0 || !form.nextOccurrence) return;
    const payload: RecurringFormData = {
      ...form,
      amount: kind === 'expense' ? -Math.abs(form.amount) : Math.abs(form.amount),
    };
    try {
      if (editingId) {
        await onUpdate(editingId, payload);
      } else {
        await onAdd(payload);
      }
      setShowForm(false);
    } catch (err) {
      console.error(err);
    }
  };

  /** Pausa/retoma uma recorrência sem apagá-la — pausada não gera novos lançamentos. */
  const handleToggleActive = async (rec: RecurringTransaction) => {
    try {
      await onUpdate(rec.id, { active: !rec.active });
    } catch (err) {
      console.error(err);
    }
  };

  /** Exclui a recorrência `id`, após confirmação. As transações já lançadas permanecem. */
  const handleDelete = async (id: string) => {
    if (confirm('Remover esta recorrência? As transações já lançadas por ela serão mantidas.')) {
      await onDelete(id);
    }
  };

  const set = (k: keyof RecurringFormData, v: string | number | boolean) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div>
      <div className="space-y-3 mb-4">
        {recurring.length === 0 && (
          <div className="glass-card rounded-xl p-8 flex flex-col items-center text-center">
            <Repeat size={32} className="text-textMuted mb-3" />
            <p className="text-white font-medium mb-1">Nenhuma recorrência cadastrada</p>
            <p className="text-textMuted text-sm">Cadastre salário, aluguel e assinaturas para lançá-los automaticamente</p>
          </div>
        )}

        {recurring.map(rec => {
          const account = accounts.find(a => a.id === rec.accountId);
          return (
            <div key={rec.id} className={`glass-card rounded-xl p-4 flex items-center gap-4 ${rec.active ? '' : 'opacity-60'}`}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  backgroundColor: rec.amount >= 0 ? 'rgba(20,184,166,0.15)' : 'rgba(236,72,153,0.15)',
                  border: `1px solid ${rec.amount >= 0 ? 'rgba(20,184,166,0.3)' : 'rgba(236,72,153,0.3)'}`,
                  color: rec.amount >= 0 ? '#2dd4bf' : '#f472b6',
                }}>
                <Repeat size={18} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-white truncate">{rec.name}</p>
                  <span className="text-xs px-2 py-0.5 rounded-full text-textMuted" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    {FREQUENCY_LABELS[rec.frequency]}
                  </span>
                  {!rec.active && (
                    <span className="text-xs px-2 py-0.5 rounded-full text-amber-300" style={{ backgroundColor: 'rgba(245,158,11,0.12)' }}>
                      Pausada
                    </span>
                  )}
                </div>
                <p className="text-xs text-textMuted">
                  {rec.category}
                  {account ? ` · ${account.name}` : ''}
                  {rec.active ? ` · próxima em ${formatDateBR(rec.nextOccurrence)}` : ''}
                </p>
              </div>

              <div className="text-right shrink-0">
                <p className={`text-lg font-bold ${rec.amount >= 0 ? 'text-teal-400' : 'text-red-400'}`}>
                  {rec.amount >= 0 ? '+' : '-'}R$ {Math.abs(rec.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
              </div>

              <div className="flex gap-1 shrink-0">
                <button onClick={() => handleToggleActive(rec)}
                  title={rec.active ? 'Pausar recorrência' : 'Retomar recorrência'}
                  aria-label={rec.active ? `Pausar ${rec.name}` : `Retomar ${rec.name}`}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors text-textMuted hover:text-white">
                  {rec.active ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button onClick={() => openEdit(rec)} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-textMuted hover:text-white">
                  <Edit2 size={14} />
                </button>
                <button onClick={() => handleDelete(rec.id)} className="p-2 hover:bg-red-500/10 rounded-lg transition-colors text-textMuted hover:text-red-400">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={openAdd}
        className="w-full py-3.5 rounded-xl font-semibold text-white text-sm flex items-center justify-center gap-2 transition-all shadow-lg"
        style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))', boxShadow: '0 4px 20px rgba(99,102,241,0.3)' }}>
        <Plus size={16} /> Adicionar Recorrência
      </button>

      {showForm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md glass-card rounded-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-bold text-white">{editingId ? 'Editar Recorrência' : 'Nova Recorrência'}</h3>
              <button onClick={() => setShowForm(false)} className="p-2 hover:bg-white/10 rounded-lg text-textMuted hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <FormField label="Nome" htmlFor="recurring-name">
                <input id="recurring-name" value={form.name} onChange={e => set('name', e.target.value)}
                  placeholder="Ex: Aluguel" className="input-field" />
              </FormField>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Tipo" htmlFor="recurring-kind">
                  <select id="recurring-kind" value={kind} onChange={e => setKind(e.target.value as 'expense' | 'income')} className="input-field">
                    <option value="expense">Despesa</option>
                    <option value="income">Receita</option>
                  </select>
                </FormField>
                <FormField label="Valor (R$)" htmlFor="recurring-amount">
                  <input id="recurring-amount" type="number" step="0.01" min="0.01" value={form.amount || ''}
                    onChange={e => set('amount', parseFloat(e.target.value) || 0)}
                    placeholder="350.00" className="input-field" />
                </FormField>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Categoria" htmlFor="recurring-category">
                  <select id="recurring-category" value={form.category} onChange={e => set('category', e.target.value)} className="input-field">
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </FormField>
                <FormField label="Frequência" htmlFor="recurring-frequency">
                  <select id="recurring-frequency" value={form.frequency}
                    onChange={e => set('frequency', e.target.value as RecurrenceFrequency)} className="input-field">
                    {(Object.entries(FREQUENCY_LABELS) as [RecurrenceFrequency, string][]).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </FormField>
              </div>

              <FormField label="Próxima Ocorrência" htmlFor="recurring-next">
                <input id="recurring-next" type="date" value={form.nextOccurrence}
                  onChange={e => set('nextOccurrence', e.target.value)} className="input-field" />
              </FormField>

              <FormField label="Vincular à Conta" htmlFor="recurring-account">
                <select id="recurring-account" value={form.accountId || ''}
                  onChange={e => set('accountId', e.target.value)} className="input-field">
                  <option value="">Sem conta específica</option>
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.bank} - {acc.name}</option>
                  ))}
                </select>
              </FormField>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-xl text-sm text-textMuted border border-white/10 hover:bg-white/5 transition-colors">Cancelar</button>
              <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl text-sm text-white font-semibold transition-colors"
                style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))' }}>
                {editingId ? 'Salvar' : 'Adicionar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
