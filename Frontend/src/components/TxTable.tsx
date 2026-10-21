import { useState, useId } from 'react';
import { Edit2, Trash2, X } from 'lucide-react';
import { BASE_CURRENCY, currencyOf, currencySymbol, formatMoney } from '../utils/currency';
import { formatDateBR } from '../utils/dates';
import { CATEGORIES, categoryDot } from '../utils/categories';
import { PAYMENT_TYPE_META, type CategoryRuleDraft } from '../utils/paymentTypes';
import type { Account, PaymentType, Transaction } from '../types';
import { ColumnFilter, type ColumnFilterProps } from './ColumnFilter';

type ColumnFilterConfig = Omit<ColumnFilterProps, 'label' | 'allLabel'>;

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
export function TxTable({ rows, accounts, onUpdate, onDelete, onCreateRule, categoryFilter, typeFilter, categories = CATEGORIES }: {
  rows: Transaction[];
  /** Opções do campo Categoria na edição (padrão: as categorias curadas). */
  categories?: string[];
  /** Filtros nos cabeçalhos de Categoria e Tipo (opcionais). */
  categoryFilter?: ColumnFilterConfig;
  typeFilter?: ColumnFilterConfig;
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
    <div className="relative overflow-x-auto">
      {/* No celular as colunas Categoria e Tipo somem; os filtros delas ficam aqui em cima. */}
      {(categoryFilter || typeFilter) && (
        <div className="md:hidden flex flex-wrap gap-x-5 gap-y-2 text-sm text-textMuted mb-3">
          {categoryFilter && <ColumnFilter label="Categoria" {...categoryFilter} />}
          {typeFilter && <ColumnFilter label="Tipo" allLabel="Todos" {...typeFilter} />}
        </div>
      )}
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-[var(--line)] text-xs text-textMuted">
            <th className="pb-2 font-normal w-24 hidden sm:table-cell">Data</th>
            <th className="pb-2 font-normal">Descrição</th>
            <th className="pb-2 font-normal hidden sm:table-cell">{categoryFilter ? <ColumnFilter label="Categoria" {...categoryFilter} /> : 'Categoria'}</th>
            <th className="pb-2 font-normal hidden md:table-cell">{typeFilter ? <ColumnFilter label="Tipo" allLabel="Todos" {...typeFilter} /> : 'Tipo'}</th>
            <th className="pb-2 font-normal text-right">Valor</th>
            <th className="pb-2 font-normal w-20"><span className="sr-only">Ações</span></th>
          </tr>
        </thead>
        <tbody className="text-sm divide-y divide-white/5">
          {rows.length === 0 && (
            <tr><td colSpan={6} className="py-6 text-textMuted">Nenhuma transação com esses filtros.</td></tr>
          )}
          {rows.map(t => {
            const pt = PAYMENT_TYPE_META[t.paymentType ?? 'debit'] ?? PAYMENT_TYPE_META['debit'];
            return (
              <tr key={t.id} className="group hover:bg-white/[0.03] transition-colors">
                <td className="py-3 pr-3 text-textMuted whitespace-nowrap hidden sm:table-cell">{formatDateBR(t.date)}</td>
                <td className="py-3 pr-3 text-white">
                  {t.name}
                  {/* No celular, data, categoria e tipo descem para uma segunda linha em vez de sumir. */}
                  <span className="block sm:hidden text-xs text-textMuted mt-0.5">
                    {formatDateBR(t.date)} · <span className="whitespace-nowrap"><span className="inline-block w-1.5 h-1.5 mr-1 rounded-full align-middle" style={categoryDot(t.category)} aria-hidden="true"/>{t.category}</span> · {pt.label}
                  </span>
                </td>
                <td className="py-3 pr-3 text-white hidden sm:table-cell">
                  <span className="inline-flex items-center gap-2"><span className="inline-block w-2 h-2 rounded-full shrink-0" style={categoryDot(t.category)} aria-hidden="true"/>{t.category}</span>
                </td>
                <td className="py-3 pr-3 text-textMuted hidden md:table-cell">{pt.label}</td>
                <td className={`py-3 text-right font-medium whitespace-nowrap ${t.amount > 0 ? 'text-teal-400' : t.amount < 0 ? 'text-red-400' : 'text-white'}`}>
                  {formatTxAmount(t)}
                </td>
                <td className="py-3 pl-2">
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
          <div className="w-full max-w-md panel rounded-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-base font-medium text-white">Editar Transação</h3>
              <button type="button" onClick={() => setEditing(null)} aria-label="Fechar" className="p-2 hover:bg-white/10 rounded-lg text-textMuted hover:text-white">
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor={`${fieldId}-name`} className="block text-xs font-medium text-textMuted mb-1.5">Descrição</label>
                <input id={`${fieldId}-name`} value={form.name ?? ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input-field" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`${fieldId}-date`} className="block text-xs font-medium text-textMuted mb-1.5">Data</label>
                  <input id={`${fieldId}-date`} type="date" value={form.date ?? ''} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="input-field" />
                </div>
                <div>
                  <label htmlFor={`${fieldId}-amount`} className="block text-xs font-medium text-textMuted mb-1.5">
                    Valor ({currencySymbol(currencyOf(accounts.find(a => a.id === form.accountId) ?? {}))})
                  </label>
                  <input id={`${fieldId}-amount`} type="number" step="0.01" value={form.amount ?? 0} onChange={e => setForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`${fieldId}-category`} className="block text-xs font-medium text-textMuted mb-1.5">Categoria</label>
                  <select id={`${fieldId}-category`} value={form.category ?? ''} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="input-field">
                    {[...new Set([form.category ?? '', ...categories])].filter(Boolean).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={`${fieldId}-type`} className="block text-xs font-medium text-textMuted mb-1.5">Tipo</label>
                  <select id={`${fieldId}-type`} value={form.paymentType ?? 'debit'} onChange={e => setForm(f => ({ ...f, paymentType: e.target.value as PaymentType }))} className="input-field">
                    {Object.entries(PAYMENT_TYPE_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor={`${fieldId}-account`} className="block text-xs font-medium text-textMuted mb-1.5">Conta</label>
                <select id={`${fieldId}-account`} value={form.accountId ?? ''} onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))} className="input-field">
                  <option value="">Sem conta vinculada</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              {onCreateRule && form.category !== editing.category && (
                <fieldset className="space-y-3 p-3 rounded-xl border border-[var(--line)]">
                  <legend className="sr-only">Regra de categoria</legend>
                  <label className="flex items-start gap-2 text-sm text-textMuted cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={rule.create}
                      onChange={e => setRule(r => ({ ...r, create: e.target.checked }))} />
                    <span>Criar regra: as próximas transações com o texto abaixo entram como {form.category}</span>
                  </label>
                  {rule.create && (
                    <>
                      <div>
                        <label htmlFor={`${fieldId}-rule`} className="block text-xs font-medium text-textMuted mb-1.5">Texto na descrição</label>
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
              <button onClick={() => setEditing(null)} className="flex-1 py-2.5 rounded-xl text-sm text-textMuted border border-[var(--line)] hover:bg-white/5 transition-colors">Cancelar</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm text-on-accent font-semibold transition-colors disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}>
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
