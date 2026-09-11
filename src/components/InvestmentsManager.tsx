import { useEffect, useMemo, useState } from 'react';
import { X, Plus, Trash2, Edit2, TrendingUp, Landmark, Layers, Bitcoin, Shapes, Info, AlertCircle } from 'lucide-react';
import type { Account, Investment, InvestmentInput, InvestmentType } from '../types';
import {
  INVESTMENT_TYPE_LABELS, computeInvestmentHoldings, computeReturn, formatSignedPercent,
  investmentTypeLabel, isInvestmentType, parseAmountInput, summarizePortfolio,
} from '../utils/investments';
import {
  BASE_CURRENCY, accountsInBase, currencyLabel, currencyOf, currencyOptions, currencySymbol,
  foreignCurrencies, formatMoney, investmentsInBase, isSupportedCurrency, type ExchangeRates,
} from '../utils/currency';
import { formatBRL } from '../utils/money';
import { formatRelativeTime } from '../utils/dates';
import { FormField } from './shared/FormField';

/** Cor e ícone de cada tipo — usados no card da posição e na barra de alocação. */
const TYPE_META: Record<InvestmentType, { color: string; icon: React.ReactNode }> = {
  fixed_income: { color: '#14b8a6', icon: <Landmark size={18} /> },
  stocks:       { color: '#6366f1', icon: <TrendingUp size={18} /> },
  funds:        { color: '#a855f7', icon: <Layers size={18} /> },
  crypto:       { color: '#f59e0b', icon: <Bitcoin size={18} /> },
  other:        { color: '#9ca3af', icon: <Shapes size={18} /> },
};

/** Cor e ícone de um tipo vindo da API; um tipo desconhecido usa os de "Outros". */
function typeMeta(type: string) {
  return isInvestmentType(type) ? TYPE_META[type] : TYPE_META.other;
}

/** Estado do formulário. Os valores ficam como texto para distinguir campo vazio de um 0 digitado. */
interface InvestmentForm {
  name: string;
  type: InvestmentType;
  accountId: string; // '' = sem conta vinculada
  currency: string;
  amountInvested: string;
  currentValue: string;
}

const EMPTY_FORM: InvestmentForm = {
  name: '', type: 'fixed_income', accountId: '', currency: BASE_CURRENCY, amountInvested: '', currentValue: '',
};

/** Valor com sinal explícito ("+US$ 150,00", "−R$ 80,00"), para o resultado de uma posição. */
function formatSignedMoney(value: number, currency: string): string {
  return `${value < 0 ? '−' : '+'}${formatMoney(value, currency)}`;
}

/** Participação na carteira ("60%", "33,3%"). */
function formatShare(share: number): string {
  return `${share.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

/**
 * "atualizado há 3 dias" / "atualizado em 02/09/2026". `formatRelativeTime` devolve uma forma
 * relativa (começa com letra) até uma semana e a data depois disso — só a data pede o "em".
 */
function updatedLabel(timestamp: string): string {
  const relative = formatRelativeTime(timestamp);
  if (!relative) return '';
  return /^\d/.test(relative) ? `atualizado em ${relative}` : `atualizado ${relative}`;
}

interface InvestmentsManagerProps {
  investments: Investment[];
  accounts: Account[];
  onAdd: (investment: InvestmentInput) => Promise<void>;
  onUpdate: (id: string, investment: InvestmentInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** Cotações para os totais em real (FIN-075). Sem elas, posições em outra moeda ficam fora dos totais. */
  rates?: ExchangeRates | null;
}

/**
 * Aba "Investimentos" (FIN-072) — carteira de posições com valor aplicado, valor atual e
 * resultado; alocação por tipo; e como cada conta de investimento entra no patrimônio
 * (FIN-073). Mesmo padrão dos demais managers: resumo, lista de cards e modal de formulário.
 * O valor atual é informado pelo usuário — por isso cada posição mostra quando foi atualizada.
 * Cada posição aparece na própria moeda; resumo, alocação e patrimônio são em real (FIN-076).
 */
export function InvestmentsManager({ investments, accounts, onAdd, onUpdate, onDelete, rates = null }: InvestmentsManagerProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<InvestmentForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // FIN-076: totais em real. Posições e contas em outra moeda entram convertidas pela cotação;
  // sem cotação, ficam de fora dos totais (com aviso), mas continuam na lista.
  const investmentsBase = useMemo(() => investmentsInBase(investments, rates), [investments, rates]);
  const accountsBase = useMemo(() => accountsInBase(accounts, rates), [accounts, rates]);
  const summary = useMemo(() => summarizePortfolio(investmentsBase.items), [investmentsBase]);
  const holdings = useMemo(
    () => computeInvestmentHoldings(accountsBase.items, investmentsBase.items),
    [accountsBase, investmentsBase]
  );
  const accountNames = useMemo(() => new Map(accounts.map(a => [a.id, a.name])), [accounts]);
  // Cartão não guarda aplicação (o servidor recusa o vínculo), então não é oferecido.
  const linkableAccounts = useMemo(() => accounts.filter(a => a.type !== 'credit'), [accounts]);
  const investmentAccounts = useMemo(() => accounts.filter(a => a.type === 'investment'), [accounts]);
  // Maiores posições primeiro (em real, para comparar moedas diferentes); empate pelo nome.
  const sorted = useMemo(() => {
    const baseValue = new Map(investmentsBase.items.map(i => [i.id, i.currentValue]));
    return [...investments].sort((a, b) =>
      (baseValue.get(b.id) ?? 0) - (baseValue.get(a.id) ?? 0) || a.name.localeCompare(b.name, 'pt-BR'));
  }, [investments, investmentsBase]);

  // Esc fecha o formulário, como no sino de notificações (FIN-066).
  useEffect(() => {
    if (!showForm) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowForm(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showForm]);

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (inv: Investment) => {
    setEditingId(inv.id);
    setForm({
      name: inv.name,
      type: isInvestmentType(inv.type) ? inv.type : 'other',
      // Um vínculo que não pode mais ser oferecido (conta excluída, ou que virou cartão) abre
      // como "sem conta": salvar desfaz o vínculo, em vez de o servidor recusar a edição.
      accountId: inv.accountId && linkableAccounts.some(a => a.id === inv.accountId) ? inv.accountId : '',
      currency: currencyOf(inv),
      amountInvested: String(inv.amountInvested),
      currentValue: String(inv.currentValue),
    });
    setFormError(null);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (saving) return;
    const name = form.name.trim();
    const amountInvested = parseAmountInput(form.amountInvested);
    // Valor atual em branco = "ainda vale o que apliquei" — o caso comum ao cadastrar.
    const currentValue = form.currentValue.trim() === '' ? amountInvested : parseAmountInput(form.currentValue);

    if (!name) { setFormError('Informe o nome do investimento.'); return; }
    if (amountInvested === null) { setFormError('Informe o valor aplicado — zero ou mais.'); return; }
    if (currentValue === null) { setFormError('O valor atual precisa ser zero ou mais.'); return; }

    const payload: InvestmentInput = {
      name,
      type: form.type,
      accountId: form.accountId || undefined,
      // Moeda fora da lista não é reenviada (a API só aceita as da lista); omitir mantém a atual.
      currency: isSupportedCurrency(form.currency) ? form.currency : undefined,
      amountInvested,
      currentValue,
    };
    setFormError(null);
    setSaving(true);
    try {
      if (editingId) {
        await onUpdate(editingId, payload);
      } else {
        await onAdd(payload);
      }
      setShowForm(false);
    } catch (err) {
      // O App já avisou o usuário; o modal fica aberto para ele corrigir e tentar de novo.
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (inv: Investment) => {
    if (!confirm(`Remover "${inv.name}" da carteira?`)) return;
    try {
      await onDelete(inv.id);
    } catch (err) {
      console.error(err);
    }
  };

  const set = <K extends keyof InvestmentForm>(key: K, value: InvestmentForm[K]) =>
    setForm(f => ({ ...f, [key]: value }));

  /** Ao escolher a conta, a moeda acompanha a dela — o caso comum; dá para trocar depois. */
  const selectAccount = (accountId: string) => {
    const account = accounts.find(a => a.id === accountId);
    setForm(f => ({ ...f, accountId, currency: account ? currencyOf(account) : f.currency }));
  };

  const gainColor = (gain: number) => (gain < 0 ? 'text-red-400' : 'text-teal-400');
  const symbol = currencySymbol(form.currency);
  const editingOriginal = editingId ? investments.find(i => i.id === editingId) : undefined;

  return (
    <div>
      {/* Resumo da carteira — FIN-029: coluna única abaixo de `sm` */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="glass-card rounded-2xl p-5">
          <p className="text-xs text-textMuted uppercase tracking-wide mb-1">Valor Atual</p>
          <p className="text-2xl font-bold text-white">{formatBRL(summary.current)}</p>
          <p className="text-xs text-textMuted mt-1">{investments.length} posição(ões)</p>
        </div>
        <div className="glass-card rounded-2xl p-5">
          <p className="text-xs text-textMuted uppercase tracking-wide mb-1">Total Aplicado</p>
          <p className="text-2xl font-bold text-white">{formatBRL(summary.invested)}</p>
        </div>
        <div className="glass-card rounded-2xl p-5">
          <p className="text-xs text-textMuted uppercase tracking-wide mb-1">Resultado</p>
          <p className={`text-2xl font-bold ${gainColor(summary.gain)}`}>{formatSignedMoney(summary.gain, BASE_CURRENCY)}</p>
          <p className="text-xs text-textMuted mt-1">
            {summary.percentage === null ? 'sem valor aplicado' : `${formatSignedPercent(summary.percentage)} sobre o aplicado`}
          </p>
        </div>
      </div>

      {investmentsBase.missing.length > 0 && (
        <p role="status" className="text-xs text-amber-300 -mt-3 mb-6 flex items-center gap-1.5">
          <AlertCircle size={14} className="shrink-0" aria-hidden="true" />
          {investmentsBase.missing.length} posição(ões) em {foreignCurrencies(investmentsBase.missing).join(', ')} fora dos
          totais: cotação indisponível no momento.
        </p>
      )}

      {/* Alocação por tipo */}
      {summary.allocation.length > 0 && (
        <section className="glass-card rounded-2xl p-5 mb-6" aria-labelledby="allocation-title">
          <h3 id="allocation-title" className="text-sm font-semibold text-white mb-3">Alocação por tipo</h3>
          {/* A barra é só visual; os números estão na lista logo abaixo. */}
          <div className="flex h-2.5 rounded-full overflow-hidden mb-4" aria-hidden="true" style={{ backgroundColor: 'var(--fg-8)' }}>
            {summary.allocation.map(slice => (
              <div key={slice.type} style={{ width: `${slice.share}%`, backgroundColor: TYPE_META[slice.type].color }} />
            ))}
          </div>
          <ul className="space-y-2">
            {summary.allocation.map(slice => (
              <li key={slice.type} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" aria-hidden="true" style={{ backgroundColor: TYPE_META[slice.type].color }} />
                  <span className="text-white truncate">{INVESTMENT_TYPE_LABELS[slice.type]}</span>
                  <span className="text-xs text-textMuted">({slice.count})</span>
                </span>
                <span className="text-textMuted shrink-0">
                  {formatBRL(slice.value)} · <span className="text-white font-medium">{formatShare(slice.share)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* FIN-073: como cada conta de investimento entra no patrimônio — sem isto, o saldo
          digitado da conta "sumir" do total ao cadastrar a primeira posição pareceria erro. */}
      {investmentAccounts.length > 0 && (
        <section className="glass-card rounded-2xl p-5 mb-6" aria-labelledby="investment-accounts-title">
          <div className="flex items-center gap-2 mb-3">
            <Info size={16} className="text-textMuted" aria-hidden="true" />
            <h3 id="investment-accounts-title" className="text-sm font-semibold text-white">Contas de investimento no patrimônio</h3>
          </div>
          <ul className="space-y-2 text-sm">
            {investmentAccounts.map(account => {
              const base = accountsBase.items.find(a => a.id === account.id);
              if (!base) {
                return (
                  <li key={account.id} className="text-textMuted">
                    <span className="text-white font-medium">{account.name}</span>{' — '}
                    sem cotação para {currencyOf(account)} no momento; fica fora do patrimônio até a cotação voltar.
                  </li>
                );
              }
              const covered = holdings.coveredAccountIds.includes(account.id);
              const linkedValue = investmentsBase.items
                .filter(i => i.accountId === account.id)
                .reduce((sum, i) => sum + i.currentValue, 0);
              return (
                <li key={account.id} className="text-textMuted">
                  <span className="text-white font-medium">{account.name}</span>{' — '}
                  {covered
                    ? <>entra pelas posições vinculadas ({formatBRL(linkedValue)}); o saldo digitado na conta ({formatBRL(base.balance)}) fica de fora, para não contar em dobro.</>
                    : <>entra pelo saldo da conta ({formatBRL(base.balance)}), porque ainda não tem posições vinculadas.</>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Posições */}
      <div className="space-y-3 mb-4">
        {investments.length === 0 && (
          <div className="glass-card rounded-xl p-8 flex flex-col items-center text-center">
            <TrendingUp size={32} className="text-textMuted mb-3" aria-hidden="true" />
            <p className="text-white font-medium mb-1">Nenhum investimento cadastrado</p>
            <p className="text-textMuted text-sm">
              Cadastre suas aplicações — CDB, Tesouro, ações, fundos, cripto — para acompanhar quanto rendem e como a carteira está distribuída
            </p>
          </div>
        )}

        {sorted.map(inv => {
          const meta = typeMeta(inv.type);
          const currency = currencyOf(inv);
          const result = computeReturn(inv.amountInvested, inv.currentValue);
          const accountName = inv.accountId ? accountNames.get(inv.accountId) : undefined;
          const updated = updatedLabel(inv.updatedAt);
          return (
            <div key={inv.id} className="glass-card rounded-xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" aria-hidden="true"
                style={{ backgroundColor: `${meta.color}25`, border: `1px solid ${meta.color}40`, color: meta.color }}>
                {meta.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{inv.name}</p>
                <p className="text-xs text-textMuted truncate">
                  {investmentTypeLabel(inv.type)}
                  {accountName && ` · ${accountName}`}
                  {updated && ` · ${updated}`}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-bold text-white">{formatMoney(inv.currentValue, currency)}</p>
                <p className={`text-xs ${gainColor(result.gain)}`}>
                  {formatSignedMoney(result.gain, currency)}{result.percentage !== null && ` (${formatSignedPercent(result.percentage)})`}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button type="button" onClick={() => openEdit(inv)} aria-label={`Editar ${inv.name}`}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors text-textMuted hover:text-white">
                  <Edit2 size={14} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => handleDelete(inv)} aria-label={`Excluir ${inv.name}`}
                  className="p-2 hover:bg-red-500/10 rounded-lg transition-colors text-textMuted hover:text-red-400">
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button type="button" onClick={openAdd}
        className="w-full py-3.5 rounded-xl font-semibold text-on-accent text-sm flex items-center justify-center gap-2 transition-all shadow-lg"
        style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))', boxShadow: '0 4px 20px rgba(99,102,241,0.3)' }}>
        <Plus size={16} aria-hidden="true" /> Adicionar Investimento
      </button>

      {showForm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="investment-form-title"
            className="w-full max-w-md glass-card rounded-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h3 id="investment-form-title" className="text-lg font-bold text-white">
                {editingId ? 'Editar Investimento' : 'Novo Investimento'}
              </h3>
              <button type="button" onClick={() => setShowForm(false)} aria-label="Fechar"
                className="p-2 hover:bg-white/10 rounded-lg text-textMuted hover:text-white">
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-4">
              <FormField label="Nome" htmlFor="investment-name">
                <input id="investment-name" value={form.name} onChange={e => set('name', e.target.value)}
                  placeholder="Ex: CDB Banco Inter 110% CDI" className="input-field" />
              </FormField>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Tipo" htmlFor="investment-type">
                  <select id="investment-type" value={form.type}
                    onChange={e => set('type', e.target.value as InvestmentType)} className="input-field">
                    {(Object.entries(INVESTMENT_TYPE_LABELS) as [InvestmentType, string][]).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Conta" htmlFor="investment-account">
                  <select id="investment-account" value={form.accountId}
                    onChange={e => selectAccount(e.target.value)} className="input-field">
                    <option value="">Sem conta vinculada</option>
                    {linkableAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name} — {a.bank}</option>
                    ))}
                  </select>
                </FormField>
              </div>

              {/* FIN-076: moeda da posição — independente da conta (uma corretora em real pode
                  custodiar um ativo cotado em dólar), mas sugerida a partir dela. */}
              <FormField label="Moeda" htmlFor="investment-currency">
                <select id="investment-currency" value={form.currency}
                  onChange={e => set('currency', e.target.value)} className="input-field">
                  {currencyOptions(editingOriginal ? currencyOf(editingOriginal) : form.currency).map(code => (
                    <option key={code} value={code}>{currencyLabel(code)}</option>
                  ))}
                </select>
              </FormField>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label={`Valor Aplicado (${symbol})`} htmlFor="investment-invested">
                  <input id="investment-invested" type="number" inputMode="decimal" step="0.01" min="0"
                    value={form.amountInvested} onChange={e => set('amountInvested', e.target.value)}
                    placeholder="1000.00" className="input-field" />
                </FormField>
                <FormField label={`Valor Atual (${symbol})`} htmlFor="investment-current">
                  <input id="investment-current" type="number" inputMode="decimal" step="0.01" min="0"
                    value={form.currentValue} onChange={e => set('currentValue', e.target.value)}
                    placeholder="Igual ao aplicado" aria-describedby="investment-current-hint" className="input-field" />
                </FormField>
              </div>
              <p id="investment-current-hint" className="text-xs text-textMuted -mt-2">
                Em branco, usa o valor aplicado. Atualize sempre que consultar o extrato da corretora.
              </p>

              {formError && <p role="alert" className="text-sm text-red-400">{formError}</p>}
            </div>

            <div className="flex gap-3 mt-6">
              <button type="button" onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 rounded-xl text-sm text-textMuted border border-white/10 hover:bg-white/5 transition-colors">
                Cancelar
              </button>
              <button type="button" onClick={handleSave} disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm text-on-accent font-semibold transition-colors disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))' }}>
                {saving ? 'Salvando...' : editingId ? 'Salvar' : 'Adicionar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
