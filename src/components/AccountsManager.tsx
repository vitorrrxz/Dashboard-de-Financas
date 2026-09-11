import { useMemo, useState } from 'react';
import { X, Plus, Trash2, Edit2, CreditCard, Landmark, PiggyBank, TrendingUp, Wallet, AlertCircle } from 'lucide-react';
import type { Account, AccountType } from '../types';
import { FormField } from './shared/FormField';
import { formatBRL } from '../utils/money';
import {
  BASE_CURRENCY, accountsInBase, currencyLabel, currencyOf, currencyOptions, currencySymbol,
  foreignCurrencies, formatMoney, isSupportedCurrency, type ExchangeRates,
} from '../utils/currency';

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
  name: '', bank: '', type: 'checking', balance: 0, currency: BASE_CURRENCY, color: '#6366f1',
};

interface AccountsManagerProps {
  accounts: Account[];
  onAdd: (acc: Omit<Account, 'id' | 'createdAt'>) => Promise<void>;
  onUpdate: (id: string, acc: Omit<Account, 'id' | 'createdAt'>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** Cotações para os totais em real (FIN-075). Sem elas, contas em outra moeda ficam fora dos totais. */
  rates?: ExchangeRates | null;
}

export function AccountsManager({ accounts, onAdd, onUpdate, onDelete, rates = null }: AccountsManagerProps) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form, setForm] = useState<Omit<Account, 'id'>>(EMPTY_ACCOUNT as Omit<Account, 'id'>);

  // FIN-076: os totais do topo são em real. Contas em outra moeda entram convertidas pela
  // cotação; sem cotação, ficam de fora (com aviso), em vez de somar dólar como se fosse real.
  const { items: accountsBase, missing } = useMemo(() => accountsInBase(accounts, rates), [accounts, rates]);

  const totalBalance = accountsBase
    .filter(a => a.type !== 'credit')
    .reduce((s, a) => s + a.balance, 0);

  const totalCredit = accountsBase
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

  const handleSave = async () => {
    if (!form.name.trim()) return;
    // Uma moeda fora da lista (conta da Pluggy em outra moeda) não é reenviada: a API só aceita
    // as da lista, e o seletor não deixa escolhê-la. A chave é removida, e não posta como
    // `undefined` — no estado local, `{ ...conta, currency: undefined }` apagaria a moeda.
    const payload: Omit<Account, 'id'> = { ...form };
    if (!isSupportedCurrency(currencyOf(form))) delete payload.currency;
    try {
      if (editing) {
        await onUpdate(editing.id, payload);
      } else {
        await onAdd(payload);
      }
      setShowForm(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Remover esta conta?')) await onDelete(id);
  };

  const set = (k: keyof Omit<Account, 'id'>, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const formCurrency = currencyOf(form);
  const symbol = currencySymbol(formCurrency);
  // Trocar a moeda de uma conta existente leva as transações dela junto (sem converter valores).
  const currencyChanged = editing !== null && currencyOf(editing) !== formCurrency;

  return (
    <div>
      {/* Summary Strip — FIN-029: coluna única abaixo de `sm` para não espremer valores monetários */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="glass-card rounded-2xl p-5">
          <p className="text-xs text-textMuted uppercase tracking-wide mb-1">Saldo Real Total</p>
          <p className={`text-2xl font-bold ${totalBalance >= 0 ? 'text-white' : 'text-red-400'}`}>
            {formatBRL(totalBalance)}
          </p>
          <p className="text-xs text-textMuted mt-1">{accounts.filter(a => a.type !== 'credit').length} conta(s)</p>
        </div>
        <div className="glass-card rounded-2xl p-5">
          <p className="text-xs text-textMuted uppercase tracking-wide mb-1">Faturas Pendentes (Cartão)</p>
          <p className="text-2xl font-bold text-red-400">
            {formatBRL(totalCredit)}
          </p>
          <p className="text-xs text-textMuted mt-1">{accounts.filter(a => a.type === 'credit').length} cartão(ões)</p>
        </div>
      </div>

      {missing.length > 0 && (
        <p role="status" className="text-xs text-amber-300 -mt-3 mb-6 flex items-center gap-1.5">
          <AlertCircle size={14} className="shrink-0" aria-hidden="true" />
          {missing.length} conta(s) em {foreignCurrencies(missing).join(', ')} fora dos totais: cotação indisponível no momento.
        </p>
      )}

      {/* Account Cards */}
      <div className="space-y-3 mb-4">
        {accounts.length === 0 && (
          <div className="glass-card rounded-xl p-8 flex flex-col items-center text-center">
            <Landmark size={32} className="text-textMuted mb-3" />
            <p className="text-white font-medium mb-1">Nenhuma conta cadastrada</p>
            <p className="text-textMuted text-sm">Adicione suas contas e cartões para ver seu saldo real</p>
          </div>
        )}
        {accounts.map(acc => {
          const currency = currencyOf(acc);
          return (
            <div key={acc.id} className="glass-card rounded-xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-white"
                style={{ backgroundColor: `${acc.color}25`, border: `1px solid ${acc.color}40`, color: acc.color }}>
                {ACCOUNT_TYPE_ICONS[acc.type]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-white truncate">{acc.name}</p>
                  <span className="text-xs px-2 py-0.5 rounded-full text-textMuted" style={{ backgroundColor: 'var(--fg-5)' }}>
                    {acc.bank}
                  </span>
                  {/* FIN-076: a moeda só aparece quando não é real, para não poluir o caso comum. */}
                  {currency !== BASE_CURRENCY && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md text-amber-300" style={{ backgroundColor: 'rgba(245,158,11,0.12)' }}>
                      {currency}
                    </span>
                  )}
                </div>
                <p className="text-xs text-textMuted">{ACCOUNT_TYPE_LABELS[acc.type]}</p>
                {acc.type === 'credit' && acc.limit && (
                  <div className="mt-2">
                    <div className="flex justify-between text-xs text-textMuted mb-1">
                      <span>Fatura: {formatMoney(acc.pendingBill ?? 0, currency)}</span>
                      <span>Limite: {formatMoney(acc.limit, currency)}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--fg-8)' }}>
                      <div className="h-full rounded-full bg-red-400 transition-all"
                        style={{ width: `${Math.min(100, ((acc.pendingBill ?? 0) / acc.limit) * 100)}%` }} />
                    </div>
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className={`text-lg font-bold ${acc.type === 'credit' ? 'text-red-400' : (acc.balance >= 0 ? 'text-white' : 'text-red-400')}`}>
                  {acc.type === 'credit' ? '-' : ''}{formatMoney(acc.type === 'credit' ? (acc.pendingBill ?? 0) : acc.balance, currency)}
                </p>
                {acc.type === 'credit' && acc.dueDay && (
                  <p className="text-xs text-textMuted">Vence dia {acc.dueDay}</p>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <button type="button" onClick={() => openEdit(acc)} aria-label={`Editar ${acc.name}`}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors text-textMuted hover:text-white">
                  <Edit2 size={14} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => handleDelete(acc.id)} aria-label={`Excluir ${acc.name}`}
                  className="p-2 hover:bg-red-500/10 rounded-lg transition-colors text-textMuted hover:text-red-400">
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={openAdd}
        className="w-full py-3.5 rounded-xl font-semibold text-on-accent text-sm flex items-center justify-center gap-2 transition-all shadow-lg"
        style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))', boxShadow: '0 4px 20px rgba(99,102,241,0.3)' }}>
        <Plus size={16} /> Adicionar Conta
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
                <FormField label="Nome da Conta" htmlFor="account-name">
                  <input id="account-name" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ex: Conta Nubank" className="input-field" />
                </FormField>
                <FormField label="Banco / Operadora" htmlFor="account-bank">
                  <input id="account-bank" value={form.bank} onChange={e => set('bank', e.target.value)} placeholder="Ex: Nubank" className="input-field" />
                </FormField>
              </div>

              <FormField label="Tipo" htmlFor="account-type">
                <select id="account-type" value={form.type} onChange={e => {
                  const newType = e.target.value as AccountType;
                  setForm(f => {
                    const next = { ...f, type: newType };
                    if (newType !== 'credit') {
                      delete next.limit;
                      delete next.pendingBill;
                      delete next.closingDay;
                      delete next.dueDay;
                    } else {
                      next.balance = 0;
                    }
                    return next;
                  });
                }} className="input-field">
                  {(Object.entries(ACCOUNT_TYPE_LABELS) as [AccountType, string][]).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </FormField>

              {/* FIN-076: moeda da conta — os valores abaixo são digitados nela. */}
              <FormField label="Moeda" htmlFor="account-currency">
                <select id="account-currency" value={formCurrency} onChange={e => set('currency', e.target.value)}
                  aria-describedby={currencyChanged ? 'account-currency-hint' : undefined} className="input-field">
                  {currencyOptions(editing ? currencyOf(editing) : formCurrency).map(code => (
                    <option key={code} value={code}>{currencyLabel(code)}</option>
                  ))}
                </select>
              </FormField>
              {currencyChanged && (
                <p id="account-currency-hint" className="text-xs text-amber-300 -mt-2">
                  As transações desta conta passam para a nova moeda; os valores não são convertidos.
                </p>
              )}

              {form.type === 'credit' ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label={`Limite do Cartão (${symbol})`} htmlFor="account-limit">
                      <input id="account-limit" type="number" value={form.limit ?? ''} onChange={e => set('limit', parseFloat(e.target.value) || 0)} placeholder="5000.00" className="input-field" />
                    </FormField>
                    <FormField label={`Fatura Pendente (${symbol})`} htmlFor="account-pending-bill">
                      <input id="account-pending-bill" type="number" value={form.pendingBill ?? ''} onChange={e => set('pendingBill', parseFloat(e.target.value) || 0)} placeholder="0.00" className="input-field" />
                    </FormField>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Dia de Fechamento" htmlFor="account-closing-day">
                      <input id="account-closing-day" type="number" min={1} max={31} value={form.closingDay ?? ''} onChange={e => set('closingDay', parseInt(e.target.value) || undefined)} placeholder="15" className="input-field" />
                    </FormField>
                    <FormField label="Dia de Vencimento" htmlFor="account-due-day">
                      <input id="account-due-day" type="number" min={1} max={31} value={form.dueDay ?? ''} onChange={e => set('dueDay', parseInt(e.target.value) || undefined)} placeholder="25" className="input-field" />
                    </FormField>
                  </div>
                </>
              ) : (
                <FormField label={`Saldo Atual (${symbol})`} htmlFor="account-balance">
                  <input id="account-balance" type="number" step="0.01" value={form.balance} onChange={e => set('balance', parseFloat(e.target.value) || 0)} placeholder="0.00" className="input-field" />
                </FormField>
              )}

              <FormField label="Cor">
                <div className="flex gap-2 flex-wrap">
                  {PRESET_COLORS.map(c => (
                    <button key={c} type="button" onClick={() => set('color', c)} aria-label={`Cor ${c}`} aria-pressed={form.color === c}
                      className="w-7 h-7 rounded-lg border-2 transition-transform hover:scale-110"
                      style={{ backgroundColor: c, borderColor: form.color === c ? 'var(--color-white)' : 'transparent' }} />
                  ))}
                </div>
              </FormField>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-xl text-sm text-textMuted border border-white/10 hover:bg-white/5 transition-colors">Cancelar</button>
              <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl text-sm text-on-accent font-semibold transition-colors"
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
