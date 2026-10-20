import { useState } from 'react';
import { X, Plus, Trash2, Edit2, Link2 } from 'lucide-react';
import type { Account, Goal, Investment } from '../types';
import { computeGoalProgress, linkedGoalAmount } from '../utils/goals';
import { todayISO } from '../utils/debts';
import { formatDateBR } from '../utils/dates';
import { FormField } from './shared/FormField';
import { formatBRL } from '../utils/money';

type GoalFormData = Omit<Goal, 'id' | 'createdAt'>;
/** Como a meta acumula: digitado à mão, ou seguindo o saldo de uma conta/o valor de um investimento (FIN-113). */
type LinkMode = 'manual' | 'account' | 'investment';

const EMPTY_GOAL: GoalFormData = { name: '', targetAmount: 0, currentAmount: 0, targetDate: '' };

interface GoalsManagerProps {
  goals: Goal[];
  /** Contas do usuário, já em real (FIN-075) — só as que não são cartão de crédito podem virar vínculo. */
  accounts: Account[];
  /** Posições da carteira (FIN-072), já em real — candidatas a vínculo. */
  investments: Investment[];
  onAdd: (goal: GoalFormData) => Promise<void>;
  onUpdate: (id: string, goal: GoalFormData) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

/** Nome de quem uma meta ligada segue, para o card e para a mensagem de exclusão. */
function linkedSourceName(goal: Goal, accounts: Account[], investments: Investment[]): string | undefined {
  if (goal.accountId) return accounts.find(a => a.id === goal.accountId)?.name ?? 'conta excluída';
  if (goal.investmentId) return investments.find(i => i.id === goal.investmentId)?.name ?? 'investimento excluído';
  return undefined;
}

/**
 * Aba "Metas" (FIN-051) — cada meta vira um card com barra de progresso
 * (`computeGoalProgress`), seguindo o mesmo padrão visual dos demais managers
 * (`AccountsManager.tsx`/`BudgetManager.tsx`): lista de cards + modal de formulário.
 *
 * FIN-113 — uma meta pode, em vez de "Já Acumulado" digitado, seguir o saldo de uma conta ou o
 * valor atual de um investimento: quem mantém isso em dia é o App (`linkedGoalAmount`, a cada
 * carga), então aqui o campo vira somente leitura enquanto ligada.
 */
export function GoalsManager({ goals, accounts, investments, onAdd, onUpdate, onDelete }: GoalsManagerProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<GoalFormData>(EMPTY_GOAL);
  const [linkMode, setLinkMode] = useState<LinkMode>('manual');

  // Cartão de crédito não guarda reserva (o saldo dele é uma fatura) — mesma regra do backend.
  const linkableAccounts = accounts.filter(a => a.type !== 'credit');

  /** Abre o modal em modo "criar", com prazo sugerido de um ano a partir de hoje. */
  const openAdd = () => {
    setEditingId(null);
    setLinkMode('manual');
    const [year, month, day] = todayISO().split('-');
    setForm({ ...EMPTY_GOAL, targetDate: `${Number(year) + 1}-${month}-${day}` });
    setShowForm(true);
  };

  /** Abre o modal em modo "editar", pré-preenchido com os dados da meta. */
  const openEdit = (goal: Goal) => {
    setEditingId(goal.id);
    setLinkMode(goal.investmentId ? 'investment' : goal.accountId ? 'account' : 'manual');
    setForm({
      name: goal.name,
      targetAmount: goal.targetAmount,
      currentAmount: goal.currentAmount,
      targetDate: goal.targetDate,
      accountId: goal.accountId,
      investmentId: goal.investmentId,
    });
    setShowForm(true);
  };

  /** Envia o formulário — cria (`onAdd`) ou atualiza (`onUpdate`) conforme `editingId`. */
  const handleSave = async () => {
    if (!form.name.trim() || form.targetAmount <= 0 || !form.targetDate) return;
    if (linkMode === 'account' && !form.accountId) return;
    if (linkMode === 'investment' && !form.investmentId) return;

    // Sempre uma string explícita (nunca `undefined`): um PUT parcial ignora campo ausente, e a
    // meta ligada nunca desligaria trocando de conta/investimento para "nenhum" (ver server.js).
    const accountId = linkMode === 'account' ? (form.accountId ?? '') : '';
    const investmentId = linkMode === 'investment' ? (form.investmentId ?? '') : '';
    const liveAmount = linkMode !== 'manual' ? linkedGoalAmount({ accountId, investmentId }, accounts, investments) : null;

    const payload: GoalFormData = {
      ...form,
      accountId,
      investmentId,
      currentAmount: liveAmount ?? form.currentAmount,
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

  /** Exclui a meta `id`, após confirmação do usuário. */
  const handleDelete = async (id: string) => {
    if (confirm('Remover esta meta?')) await onDelete(id);
  };

  const set = (k: keyof GoalFormData, v: string | number) => setForm(f => ({ ...f, [k]: v }));
  // Prévia do "Já Acumulado" enquanto o usuário escolhe a conta/investimento, antes de salvar.
  const previewAmount = linkMode !== 'manual'
    ? linkedGoalAmount({ accountId: form.accountId, investmentId: form.investmentId }, accounts, investments)
    : null;

  return (
    <div>
      <div className="space-y-3 mb-4">
        {goals.length === 0 && (
          <p className="text-sm text-textMuted">Nenhuma meta ainda. Defina quanto quer juntar e até quando; ligada a uma conta ou investimento, ela anda sozinha.</p>
        )}

        {goals.map(goal => {
          const progress = computeGoalProgress(goal);
          const barColor = progress.isAchieved ? 'var(--color-teal-500)' : progress.isOverdue ? 'var(--color-red-500)' : 'var(--color-accent)';
          return (
            <div key={goal.id} className="panel rounded-xl p-4">
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{goal.name}</p>
                  <p className="text-xs text-textMuted">
                    {formatBRL(goal.currentAmount)} de {formatBRL(goal.targetAmount)}
                    {' · '}
                    {progress.isAchieved ? <span className="text-teal-400">meta atingida</span> : `faltam ${formatBRL(progress.remaining)}`}
                  </p>
                  {(goal.accountId || goal.investmentId) && (
                    <p className="text-xs text-textMuted flex items-center gap-1 mt-0.5">
                      <Link2 size={11} className="shrink-0" /> Ligada a {linkedSourceName(goal, accounts, investments)}
                    </p>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <p className={`text-base font-medium ${progress.isOverdue ? 'text-red-400' : 'text-white'}`}>
                    {Math.round(progress.percentage)}%
                  </p>
                  <p className={`text-xs ${progress.isOverdue ? 'text-red-400' : 'text-textMuted'}`}>
                    até {formatDateBR(goal.targetDate)}
                  </p>
                </div>

                <div className="flex gap-1 shrink-0">
                  <button type="button" onClick={() => openEdit(goal)} aria-label={`Editar a meta ${goal.name}`} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-textMuted hover:text-white">
                    <Edit2 size={14} />
                  </button>
                  <button type="button" onClick={() => handleDelete(goal.id)} aria-label={`Excluir a meta ${goal.name}`} className="p-2 hover:bg-red-500/10 rounded-lg transition-colors text-textMuted hover:text-red-400">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="h-1.5 rounded-full overflow-hidden mt-3" style={{ backgroundColor: 'var(--fg-8)' }}>
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, progress.percentage)}%`, backgroundColor: barColor }} />
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={openAdd}
        className="w-full h-12 rounded-xl border border-dashed border-[var(--control)] text-sm text-textMuted hover:text-white hover:border-[var(--color-textMuted)] flex items-center justify-center gap-2 transition-colors">
        <Plus size={15} /> Adicionar meta
      </button>

      {showForm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md panel rounded-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-base font-medium text-white">{editingId ? 'Editar meta' : 'Nova meta'}</h3>
              <button onClick={() => setShowForm(false)} className="p-2 hover:bg-white/10 rounded-lg text-textMuted hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <FormField label="Nome da Meta" htmlFor="goal-name">
                <input id="goal-name" value={form.name} onChange={e => set('name', e.target.value)}
                  placeholder="Ex: Reserva de emergência" className="input-field" />
              </FormField>

              <FormField label="Acompanhar Progresso Por" htmlFor="goal-link-mode">
                <select id="goal-link-mode" value={linkMode}
                  onChange={e => setLinkMode(e.target.value as LinkMode)} className="input-field">
                  <option value="manual">Valor digitado à mão</option>
                  <option value="account">Saldo de uma conta</option>
                  <option value="investment">Valor de um investimento</option>
                </select>
              </FormField>

              {linkMode === 'account' && (
                <FormField label="Conta" htmlFor="goal-account">
                  <select id="goal-account" value={form.accountId ?? ''} onChange={e => set('accountId', e.target.value)} className="input-field">
                    <option value="">Selecione...</option>
                    {linkableAccounts.map(acc => <option key={acc.id} value={acc.id}>{acc.bank} - {acc.name}</option>)}
                  </select>
                </FormField>
              )}
              {linkMode === 'investment' && (
                <FormField label="Investimento" htmlFor="goal-investment">
                  <select id="goal-investment" value={form.investmentId ?? ''} onChange={e => set('investmentId', e.target.value)} className="input-field">
                    <option value="">Selecione...</option>
                    {investments.map(inv => <option key={inv.id} value={inv.id}>{inv.name}</option>)}
                  </select>
                </FormField>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Valor da Meta (R$)" htmlFor="goal-target">
                  <input id="goal-target" type="number" step="0.01" min="0.01" value={form.targetAmount || ''}
                    onChange={e => set('targetAmount', parseFloat(e.target.value) || 0)}
                    placeholder="10000.00" className="input-field" />
                </FormField>
                {linkMode === 'manual' ? (
                  <FormField label="Já Acumulado (R$)" htmlFor="goal-current">
                    <input id="goal-current" type="number" step="0.01" min="0" value={form.currentAmount || ''}
                      onChange={e => set('currentAmount', parseFloat(e.target.value) || 0)}
                      placeholder="0.00" className="input-field" />
                  </FormField>
                ) : (
                  <FormField label="Já Acumulado (R$)" htmlFor="goal-current-preview">
                    <div id="goal-current-preview" className="input-field flex items-center text-textMuted" aria-readonly="true">
                      {previewAmount !== null
                        ? `R$ ${previewAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                        : 'selecione acima'}
                    </div>
                  </FormField>
                )}
              </div>

              <FormField label="Prazo" htmlFor="goal-date">
                <input id="goal-date" type="date" value={form.targetDate}
                  onChange={e => set('targetDate', e.target.value)} className="input-field" />
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
