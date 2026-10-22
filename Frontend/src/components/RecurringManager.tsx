import { useMemo, useState } from 'react';
import { X, Plus, Trash2, Edit2, Pause, Play } from 'lucide-react';
import { formatBRL } from '../utils/money';
import type { Account, RecurrenceFrequency, RecurringTransaction, Transaction } from '../types';
import { CATEGORIES, EXPENSE_CATEGORIES, OWN_TRANSFER_CATEGORIES, categoryDot } from '../utils/categories';
import { todayISO } from '../utils/debts';
import { formatDateBR } from '../utils/dates';
import { bankGroupOf, groupByBank, primaryAccountOf } from '../utils/accountGroups';
import {
  detectSubscriptions, monthlySubscriptionCost, readDismissedSubscriptions, dismissSubscription,
  type DetectedSubscription,
} from '../utils/subscriptions';
import { FormField } from './shared/FormField';

type RecurringFormData = Omit<RecurringTransaction, 'id' | 'createdAt'>;

/** Rótulos em português das frequências suportadas (ver `RecurrenceFrequency` em utils/dates.ts). */
const FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  weekly: 'Semanal',
  monthly: 'Mensal',
  yearly: 'Anual',
};

const EMPTY_RECURRING: RecurringFormData = {
  name: '', category: '', amount: 0,
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
  /** Histórico completo, para a detecção de assinaturas (FIN-111) — não só o mês em exibição em Transações. */
  transactions: Transaction[];
  /** Despesas Recorrentes só lista e cria despesas; Devedores, só receitas. */
  kind: 'expense' | 'income';
}

/**
 * Abas "Despesas Recorrentes" e "Devedores" (FIN-056) — cadastro das transações que se repetem,
 * uma aba por tipo (o sinal de `amount`). Não lança nada por conta própria: quem gera as `Transaction` reais é o
 * endpoint `/api/recurring-transactions/process`, disparado no carregamento do app (FIN-055).
 */
export function RecurringManager({ recurring: allRecurring, accounts, onAdd, onUpdate, onDelete, transactionCategories, transactions, kind }: RecurringManagerProps) {
  const isExpense = kind === 'expense';
  const recurring = useMemo(
    () => allRecurring.filter(r => (r.amount < 0) === isExpense),
    [allRecurring, isExpense]
  );
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RecurringFormData>(EMPTY_RECURRING);
  // O vínculo é com o banco: conta corrente e cartão do mesmo banco aparecem uma vez só, e grava a
  // conta que representa o banco (`primaryAccountOf`).
  const bankGroups = useMemo(() => groupByBank(accounts), [accounts]);

  // FIN-111 — sugestões de assinatura, descartadas só neste navegador (ver utils/subscriptions.ts).
  // Assinatura é despesa: em Devedores não há sugestões.
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissedSubscriptions());
  const suggestions = useMemo(
    () => isExpense ? detectSubscriptions(transactions, allRecurring, dismissed) : [],
    [isExpense, transactions, allRecurring, dismissed]
  );
  const suggestionsMonthlyTotal = useMemo(
    () => suggestions.reduce((sum, s) => sum + monthlySubscriptionCost(s), 0),
    [suggestions]
  );

  /** Cria a recorrência a partir da sugestão — some da lista assim que `recurring` for atualizado pelo pai. */
  const handleCreateFromSuggestion = async (sub: DetectedSubscription) => {
    try {
      await onAdd({
        name: sub.name, category: sub.category, amount: sub.amount,
        frequency: sub.frequency, nextOccurrence: sub.nextOccurrence, active: true,
      });
    } catch (err) {
      console.error(err);
    }
  };

  /** Ignora a sugestão — persiste no navegador (FIN-077: sem sincronização entre dispositivos). */
  const handleDismissSuggestion = (key: string) => {
    dismissSubscription(key);
    setDismissed(prev => new Set(prev).add(key));
  };

  // O valor é digitado sempre positivo; o sinal vem da aba (mesma convenção de
  // `Transaction.amount`: negativo = despesa). Despesa não usa "Receita" nem as transferências;
  // receita parte de "Receita", mas aceita as demais.
  const categories = isExpense
    ? Array.from(new Set([...EXPENSE_CATEGORIES, ...transactionCategories.filter(c => c !== 'Receita' && !OWN_TRANSFER_CATEGORIES.includes(c))]))
    : Array.from(new Set([...CATEGORIES, ...transactionCategories]));

  /** Abre o modal em modo "criar", com a próxima ocorrência sugerida para hoje. */
  const openAdd = () => {
    setEditingId(null);
    setForm({ ...EMPTY_RECURRING, category: isExpense ? EXPENSE_CATEGORIES[0] : 'Receita', nextOccurrence: todayISO() });
    setShowForm(true);
  };

  /** Abre o modal em modo "editar", pré-preenchido com os dados da recorrência. */
  const openEdit = (rec: RecurringTransaction) => {
    setEditingId(rec.id);
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

  /** Envia o formulário, aplicando o sinal do valor conforme a aba. */
  const handleSave = async () => {
    if (!form.name.trim() || form.amount <= 0 || !form.nextOccurrence) return;
    const bank = bankGroupOf(bankGroups, form.accountId);
    const payload: RecurringFormData = {
      ...form,
      // Recorrência antiga ligada ao cartão passa para a conta do banco ao ser salva.
      accountId: bank ? primaryAccountOf(bank).id : form.accountId,
      amount: isExpense ? -Math.abs(form.amount) : Math.abs(form.amount),
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
      {suggestions.length > 0 && (
        <div className="panel rounded-xl p-4 mb-4">
          <h3 className="text-sm font-medium text-white mb-1">Assinaturas encontradas nas suas transações</h3>
          <p className="text-xs text-textMuted mb-3">
            Cerca de {formatBRL(suggestionsMonthlyTotal)} por mês. Crie a recorrência para lançá-las sozinhas, ou ignore.
          </p>
          <div className="space-y-2">
            {suggestions.map(sub => (
              <div key={sub.key} className="flex items-center gap-3 rounded-lg p-3" style={{ backgroundColor: 'var(--fg-5)' }}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{sub.name}</p>
                  <p className="text-xs text-textMuted">
                    {FREQUENCY_LABELS[sub.frequency]} · {sub.occurrences}x · {sub.category}
                  </p>
                </div>
                <p className="text-sm font-medium text-white shrink-0">
                  {formatBRL(sub.amount)}
                </p>
                <button type="button" onClick={() => handleCreateFromSuggestion(sub)}
                  className="h-8 text-sm px-3 rounded-md text-white bg-card border border-[var(--control)] hover:border-[var(--color-textMuted)] shrink-0 whitespace-nowrap transition-colors">
                  Criar recorrência
                </button>
                <button onClick={() => handleDismissSuggestion(sub.key)} title="Ignorar sugestão"
                  aria-label={`Ignorar sugestão de assinatura ${sub.name}`}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors text-textMuted hover:text-white shrink-0">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3 mb-4">
        {recurring.length === 0 && (
          <p className="text-sm text-textMuted">
            {isExpense
              ? 'Nenhuma despesa recorrente ainda. Cadastre aluguel e assinaturas para lançá-los sozinhos na data.'
              : 'Nenhum devedor ainda. Cadastre quem te paga todo mês para lançar a receita sozinha na data.'}
          </p>
        )}

        {recurring.map(rec => {
          const bank = bankGroupOf(bankGroups, rec.accountId);
          return (
            <div key={rec.id} className={`panel rounded-xl p-4 flex items-center gap-4 ${rec.active ? '' : 'opacity-60'}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white truncate">{rec.name}</p>
                  <span className="text-xs px-2 py-0.5 rounded-full text-textMuted" style={{ backgroundColor: 'var(--fg-5)' }}>
                    {FREQUENCY_LABELS[rec.frequency]}
                  </span>
                  {!rec.active && (
                    <span className="text-xs px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: 'var(--fg-6)', color: 'var(--color-textMain)' }}>
                      Pausada
                    </span>
                  )}
                </div>
                <p className="text-xs text-textMuted flex items-center gap-1.5 flex-wrap">
                  <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={categoryDot(rec.category)} aria-hidden="true"/>{rec.category}
                  {bank ? ` · ${bank.bank}` : ''}
                  {rec.active ? ` · próxima em ${formatDateBR(rec.nextOccurrence)}` : ''}
                </p>
              </div>

              <div className="text-right shrink-0">
                <p className={`text-base font-medium ${rec.amount >= 0 ? 'text-teal-400' : 'text-red-400'}`}>
                  {rec.amount >= 0 ? '+' : '−'}{formatBRL(rec.amount)}
                </p>
              </div>

              <div className="flex gap-1 shrink-0">
                <button onClick={() => handleToggleActive(rec)}
                  title={rec.active ? 'Pausar recorrência' : 'Retomar recorrência'}
                  aria-label={rec.active ? `Pausar ${rec.name}` : `Retomar ${rec.name}`}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors text-textMuted hover:text-white">
                  {rec.active ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button type="button" onClick={() => openEdit(rec)} aria-label={`Editar ${rec.name}`} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-textMuted hover:text-white">
                  <Edit2 size={14} />
                </button>
                <button type="button" onClick={() => handleDelete(rec.id)} aria-label={`Excluir ${rec.name}`} className="p-2 hover:bg-red-500/10 rounded-lg transition-colors text-textMuted hover:text-red-400">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={openAdd}
        className="w-full h-12 rounded-xl border border-dashed border-[var(--control)] text-sm text-textMuted hover:text-white hover:border-[var(--color-textMuted)] flex items-center justify-center gap-2 transition-colors">
        <Plus size={15} /> {isExpense ? 'Adicionar despesa recorrente' : 'Adicionar devedor'}
      </button>

      {showForm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md panel rounded-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-base font-medium text-white">{isExpense
                ? (editingId ? 'Editar Despesa Recorrente' : 'Nova Despesa Recorrente')
                : (editingId ? 'Editar Devedor' : 'Novo Devedor')}</h3>
              <button onClick={() => setShowForm(false)} className="p-2 hover:bg-white/10 rounded-lg text-textMuted hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <FormField label="Nome" htmlFor="recurring-name">
                <input id="recurring-name" value={form.name} onChange={e => set('name', e.target.value)}
                  placeholder={isExpense ? 'Ex: Aluguel' : 'Ex: João (empréstimo)'} className="input-field" />
              </FormField>

              <FormField label="Valor (R$)" htmlFor="recurring-amount">
                <input id="recurring-amount" type="number" step="0.01" min="0.01" value={form.amount || ''}
                  onChange={e => set('amount', parseFloat(e.target.value) || 0)}
                  placeholder="350.00" className="input-field" />
              </FormField>

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
                <select id="recurring-account" value={bankGroupOf(bankGroups, form.accountId)?.key ?? ''}
                  onChange={e => {
                    const bank = bankGroups.find(g => g.key === e.target.value);
                    set('accountId', bank ? primaryAccountOf(bank).id : '');
                  }} className="input-field">
                  <option value="">Sem conta específica</option>
                  {bankGroups.map(group => (
                    <option key={group.key} value={group.key}>{group.bank}</option>
                  ))}
                </select>
              </FormField>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-xl text-sm text-textMuted border border-[var(--line)] hover:bg-white/5 transition-colors">Cancelar</button>
              <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl text-sm text-on-accent font-semibold transition-colors"
                style={{ background: 'var(--color-primary)' }}>
                {editingId ? 'Salvar' : 'Adicionar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
