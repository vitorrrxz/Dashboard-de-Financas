import { useState, useId } from 'react';
import { Edit2, Trash2, X } from 'lucide-react';
import { BASE_CURRENCY, currencyOf, currencySymbol, formatMoney } from '../utils/currency';
import { formatDateBR } from '../utils/dates';
import { CATEGORY_COLORS } from '../utils/categories';
import { readableColor } from '../utils/theme';
import { PAYMENT_TYPE_META, type CategoryRuleDraft } from '../utils/paymentTypes';
import type { Account, PaymentType, Transaction } from '../types';

/**
 * Valor de uma transação na lista (FIN-076): em real, como sempre ("-35,49"); em outra moeda,
 * com o símbolo dela ("-US$ 12,00"), para um dólar nunca parecer um real.
 */
function formatTxAmount(t: Transaction): string {
  const currency = currencyOf(t);
  if (currency === BASE_CURRENCY) {
    return `${t.amount >= 0 ? '+' : ''}${t.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  }
  return `${t.amount < 0 ? '-' : '+'}${formatMoney(t.amount, currency)}`;
}

/** FIN-106 — texto sugerido para a regra: a descrição sem o código do fim ("UBER *TRIP 1234" → "UBER *TRIP"). */
const suggestRuleMatch = (name: string) => name.replace(/[\d\s*#./-]+$/, '').trim() || name.trim();

// FIN-022: edição/exclusão individual de transação. `rows` continua sendo o recorte já
// filtrado/paginado calculado pelo componente pai — este componente só adiciona a UI de
// ação por linha e o modal de edição. Exportado para o teste das ações (FIN-099).
export function TxTable({ rows, accounts, onUpdate, onDelete, onCreateRule }: {
  rows: Transaction[];
  accounts: Account[];
  onUpdate: (id: string, tx: Partial<Transaction>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCreateRule?: (rule: CategoryRuleDraft) => Promise<void>;
}) {
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [form, setForm] = useState<Partial<Transaction>>({});
  const [saving, setSaving] = useState(false);
  const fieldId = useId();
  // FIN-106: ao trocar a categoria, a correção pode virar regra de categoria (FIN-105).
  const [rule, setRule] = useState({ create: false, match: '', applyToExisting: false });

  const openEdit = (t: Transaction) => {
    setEditing(t);
    setForm({ ...t });
    setRule({ create: false, match: suggestRuleMatch(t.name), applyToExisting: false });
  };

  const handleSave = async () => {
    if (!editing || !form.name?.trim() || !form.date || form.amount === undefined) return;
    setSaving(true);
    try {
      await onUpdate(editing.id, form);
      if (onCreateRule && rule.create && form.category && form.category !== editing.category) {
        await onCreateRule({ match: rule.match.trim(), category: form.category, applyToExisting: rule.applyToExisting });
      }
      setEditing(null);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (t: Transaction) => {
    if (confirm(`Excluir a transação "${t.name}"?`)) await onDelete(t.id);
  };

  return (
    <div className="overflow-x-auto min-h-[400px]">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-textMuted">
            <th className="pb-3 font-semibold w-24">Data</th>
            <th className="pb-3 font-semibold">Descrição</th>
            <th className="pb-3 font-semibold">Categoria</th>
            <th className="pb-3 font-semibold">Tipo</th>
            <th className="pb-3 font-semibold text-right">Valor</th>
            <th className="pb-3 font-semibold w-20 text-right">Ações</th>
          </tr>
        </thead>
        <tbody className="text-sm divide-y divide-white/5">
          {rows.map(t => {
            const pt = PAYMENT_TYPE_META[t.paymentType ?? 'debit'] ?? PAYMENT_TYPE_META['debit'];
            return (
              <tr key={t.id} className="group hover:bg-white/[0.02] transition-colors">
                <td className="py-4 text-textMuted">{formatDateBR(t.date)}</td>
                <td className="py-4 font-medium text-white">{t.name}</td>
                <td className="py-4">
                  <span className="px-2.5 py-1 rounded-full text-xs border"
                    style={{
                      backgroundColor: CATEGORY_COLORS[t.category] ? `${CATEGORY_COLORS[t.category]}15` : 'var(--fg-5)',
                      borderColor: CATEGORY_COLORS[t.category] ? `${CATEGORY_COLORS[t.category]}30` : 'var(--fg-10)',
                      color: CATEGORY_COLORS[t.category] ? readableColor(CATEGORY_COLORS[t.category]) : 'var(--color-textMuted)'
                    }}>
                    {t.category}
                  </span>
                </td>
                <td className="py-4">
                  <span
                    className="px-2.5 py-1 rounded-full text-xs font-semibold border"
                    style={{
                      backgroundColor: `${pt.color}15`,
                      borderColor: `${pt.color}35`,
                      color: readableColor(pt.color),
                    }}
                  >
                    {pt.label}
                  </span>
                </td>
                <td className={`py-4 text-right font-bold ${t.amount >= 0 ? 'text-teal-400' : 'text-red-400'}`}>
                  {formatTxAmount(t)}
                </td>
                <td className="py-4">
                  {/* FIN-099: tela de toque não tem "passar o mouse" — lá as ações ficam sempre visíveis,
                      e em qualquer tela aparecem quando o foco do teclado chega a elas. */}
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100 transition-opacity">
                    <button type="button" onClick={() => openEdit(t)} aria-label={`Editar ${t.name}`}
                      className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-textMuted hover:text-white">
                      <Edit2 size={13} aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => handleDelete(t)} aria-label={`Excluir ${t.name}`}
                      className="p-1.5 hover:bg-red-500/10 rounded-lg transition-colors text-textMuted hover:text-red-400">
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {editing && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md glass-card rounded-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-bold text-white">Editar Transação</h3>
              <button type="button" onClick={() => setEditing(null)} aria-label="Fechar" className="p-2 hover:bg-white/10 rounded-lg text-textMuted hover:text-white">
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor={`${fieldId}-name`} className="block text-xs font-medium text-textMuted mb-1.5 uppercase tracking-wide">Descrição</label>
                <input id={`${fieldId}-name`} value={form.name ?? ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input-field" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`${fieldId}-date`} className="block text-xs font-medium text-textMuted mb-1.5 uppercase tracking-wide">Data</label>
                  <input id={`${fieldId}-date`} type="date" value={form.date ?? ''} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="input-field" />
                </div>
                <div>
                  <label htmlFor={`${fieldId}-amount`} className="block text-xs font-medium text-textMuted mb-1.5 uppercase tracking-wide">
                    Valor ({currencySymbol(currencyOf(accounts.find(a => a.id === form.accountId) ?? {}))})
                  </label>
                  <input id={`${fieldId}-amount`} type="number" step="0.01" value={form.amount ?? 0} onChange={e => setForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`${fieldId}-category`} className="block text-xs font-medium text-textMuted mb-1.5 uppercase tracking-wide">Categoria</label>
                  <select id={`${fieldId}-category`} value={form.category ?? ''} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="input-field">
                    {Object.keys(CATEGORY_COLORS).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={`${fieldId}-type`} className="block text-xs font-medium text-textMuted mb-1.5 uppercase tracking-wide">Tipo</label>
                  <select id={`${fieldId}-type`} value={form.paymentType ?? 'debit'} onChange={e => setForm(f => ({ ...f, paymentType: e.target.value as PaymentType }))} className="input-field">
                    {Object.entries(PAYMENT_TYPE_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor={`${fieldId}-account`} className="block text-xs font-medium text-textMuted mb-1.5 uppercase tracking-wide">Conta</label>
                <select id={`${fieldId}-account`} value={form.accountId ?? ''} onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))} className="input-field">
                  <option value="">Sem conta vinculada</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              {onCreateRule && form.category !== editing.category && (
                <fieldset className="space-y-3 p-3 rounded-xl border border-white/10">
                  <legend className="sr-only">Regra de categoria</legend>
                  <label className="flex items-start gap-2 text-sm text-textMuted cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={rule.create}
                      onChange={e => setRule(r => ({ ...r, create: e.target.checked }))} />
                    <span>Criar regra: as próximas transações com o texto abaixo entram como {form.category}</span>
                  </label>
                  {rule.create && (
                    <>
                      <div>
                        <label htmlFor={`${fieldId}-rule`} className="block text-xs font-medium text-textMuted mb-1.5 uppercase tracking-wide">Texto na descrição</label>
                        <input id={`${fieldId}-rule`} value={rule.match} onChange={e => setRule(r => ({ ...r, match: e.target.value }))} className="input-field" />
                      </div>
                      <label className="flex items-center gap-2 text-sm text-textMuted cursor-pointer">
                        <input type="checkbox" checked={rule.applyToExisting}
                          onChange={e => setRule(r => ({ ...r, applyToExisting: e.target.checked }))} />
                        Aplicar também às transações já gravadas
                      </label>
                    </>
                  )}
                </fieldset>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setEditing(null)} className="flex-1 py-2.5 rounded-xl text-sm text-textMuted border border-white/10 hover:bg-white/5 transition-colors">Cancelar</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm text-on-accent font-semibold transition-colors disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))' }}>
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
