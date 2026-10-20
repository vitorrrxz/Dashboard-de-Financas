import { useState } from 'react';
import { X, Plus, Trash2, Edit2 } from 'lucide-react';
import type { Budget } from '../types';
import type { BudgetProgress } from '../utils/budget';
import { EXPENSE_CATEGORIES } from '../utils/categories';
import { FormField } from './shared/FormField';
import { formatBRL } from '../utils/money';

type BudgetFormData = Omit<Budget, 'id' | 'createdAt'>;
const EMPTY_BUDGET: BudgetFormData = { category: EXPENSE_CATEGORIES[0], monthlyLimit: 0 };

interface BudgetManagerProps {
  budgetProgress: BudgetProgress[];
  onAdd: (budget: BudgetFormData) => Promise<void>;
  onUpdate: (id: string, budget: BudgetFormData) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** Categorias que já têm orçamento cadastrado — usado para não oferecer a mesma
   * categoria duas vezes ao criar (o backend rejeita com 400, mas bloquear na UI evita
   * a viagem de rede desnecessária e a mensagem de erro genérica). */
  existingCategories: string[];
  /** Categorias presentes nas transações reais do usuário, além das 8 fixas em
   * `EXPENSE_CATEGORIES` — a importação manual (CSV/OFX) aceita categoria livre
   * (`transactionSchema.category` no backend não é um enum), então o usuário pode ter
   * gastos numa categoria que não está na lista curada. Sem isto, seria impossível criar
   * um orçamento para essa categoria pelo formulário. */
  transactionCategories: string[];
}

/**
 * Aba "Orçamento" (FIN-045) — lista de orçamentos com barra de progresso (via
 * `budgetProgress`, já calculado por `computeBudgetProgress`) e modal de criação/edição.
 * Segue o mesmo padrão visual/estrutural de `AccountsManager.tsx`/`DebtManager.tsx`
 * (cards + modal de formulário).
 */
export function BudgetManager({ budgetProgress, onAdd, onUpdate, onDelete, existingCategories, transactionCategories }: BudgetManagerProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BudgetFormData>(EMPTY_BUDGET);

  // União das categorias curadas com as que já aparecem nas transações do usuário — ver
  // o campo `transactionCategories` acima.
  const allCategories = Array.from(new Set([...EXPENSE_CATEGORIES, ...transactionCategories]));

  // Categorias sem orçamento cadastrado ainda — usada tanto para popular o select ao
  // criar quanto para escolher um valor padrão válido (ver `openAdd` abaixo).
  const categoriesWithoutBudget = allCategories.filter(c => !existingCategories.includes(c));

  /** Abre o modal em modo "criar", pré-selecionando a primeira categoria ainda sem orçamento. */
  const openAdd = () => {
    setEditingId(null);
    // Preenche com a primeira categoria realmente disponível, não com
    // `EXPENSE_CATEGORIES[0]` fixo — que já pode estar orçado, e nesse caso o próprio
    // formulário abriria com uma categoria inválida pré-selecionada.
    setForm({ ...EMPTY_BUDGET, category: categoriesWithoutBudget[0] ?? EMPTY_BUDGET.category });
    setShowForm(true);
  };

  /** Abre o modal em modo "editar", pré-preenchido com os dados do orçamento `b`. */
  const openEdit = (b: BudgetProgress) => {
    setEditingId(b.id);
    setForm({ category: b.category, monthlyLimit: b.limit });
    setShowForm(true);
  };

  /** Envia o formulário — cria (`onAdd`) ou atualiza (`onUpdate`) conforme `editingId`. */
  const handleSave = async () => {
    if (!form.category.trim() || form.monthlyLimit <= 0) return;
    try {
      if (editingId) {
        await onUpdate(editingId, form);
      } else {
        await onAdd(form);
      }
      setShowForm(false);
    } catch (err) {
      console.error(err);
    }
  };

  /** Exclui o orçamento `id`, após confirmação do usuário. */
  const handleDelete = async (id: string) => {
    if (confirm('Remover este orçamento?')) await onDelete(id);
  };

  // Ao editar, a própria categoria do orçamento não deve ser tratada como "já existente"
  // (senão o select a esconderia da lista de opções ao editar) — mas essa exceção só se
  // aplica em modo de edição: em modo de criação, `form.category` nunca deve escapar do
  // filtro de "já existe", nem mesmo o valor default escolhido em `openAdd`.
  const availableCategories = editingId
    ? allCategories.filter(c => c === form.category || !existingCategories.includes(c))
    : categoriesWithoutBudget;

  return (
    <div>
      <div className="space-y-3 mb-4">
        {budgetProgress.length === 0 && (
          <p className="text-sm text-textMuted">Nenhum orçamento ainda. Defina um limite por categoria — o Dashboard avisa quando um deles estourar.</p>
        )}
        {budgetProgress.map(b => (
          <div key={b.id} className="panel rounded-xl p-4">
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{b.category}</p>
                <p className="text-xs text-textMuted">
                  {formatBRL(b.spent)} de {formatBRL(b.limit)}{b.isOverLimit && <span className="text-red-400"> · {formatBRL(b.spent - b.limit)} acima</span>}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-base font-medium ${b.isOverLimit ? 'text-red-400' : 'text-white'}`}>{Math.round(b.percentage)}%</p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button type="button" onClick={() => openEdit(b)} aria-label={`Editar orçamento de ${b.category}`} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-textMuted hover:text-white">
                  <Edit2 size={14} />
                </button>
                <button type="button" onClick={() => handleDelete(b.id)} aria-label={`Excluir orçamento de ${b.category}`} className="p-2 hover:bg-red-500/10 rounded-lg transition-colors text-textMuted hover:text-red-400">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden mt-3" style={{ backgroundColor: 'var(--fg-8)' }}>
              <div className="h-full rounded-full transition-all"
                style={{ width: `${Math.min(100, b.percentage)}%`, backgroundColor: b.isOverLimit ? 'var(--color-red-500)' : 'var(--chart-ink)' }} />
            </div>
          </div>
        ))}
      </div>

      {/* Desabilitado quando toda categoria de despesa já tem orçamento — independe de
          `editingId`, que pode ainda referenciar a última edição até `openAdd` rodar. */}
      <button onClick={openAdd} disabled={categoriesWithoutBudget.length === 0}
        className="w-full h-12 rounded-xl border border-dashed border-[var(--control)] text-sm text-textMuted hover:text-white hover:border-[var(--color-textMuted)] flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
        <Plus size={15} /> Adicionar orçamento
      </button>

      {showForm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md panel rounded-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-base font-medium text-white">{editingId ? 'Editar Orçamento' : 'Novo Orçamento'}</h3>
              <button onClick={() => setShowForm(false)} className="p-2 hover:bg-white/10 rounded-lg text-textMuted hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <FormField label="Categoria" htmlFor="budget-category">
                <select id="budget-category" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="input-field">
                  {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </FormField>

              <FormField label="Limite Mensal (R$)" htmlFor="budget-limit">
                <input id="budget-limit" type="number" step="0.01" min="0.01" value={form.monthlyLimit || ''}
                  onChange={e => setForm(f => ({ ...f, monthlyLimit: parseFloat(e.target.value) || 0 }))}
                  placeholder="500.00" className="input-field" />
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
