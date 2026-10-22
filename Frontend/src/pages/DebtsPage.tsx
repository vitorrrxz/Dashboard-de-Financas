import { useState } from 'react';
import { InstallmentsPanel } from '../components/InstallmentsPanel';
import { DebtManager } from '../components/DebtManager';
import { AccountFilter } from '../components/AccountFilter';
import type { Account, Debt, Transaction } from '../types';
import { BASE_CURRENCY, currencyOf } from '../utils/currency';
import { accountIdsOf, inAccounts } from '../utils/accountGroups';

interface DebtsPageProps {
  transactionsBase: Transaction[];
  debts: Debt[];
  accounts: Account[];
  /** Conta ou banco do filtro (null = todas). Dívida sem conta só aparece em "todas". */
  accountId: string | null;
  onChangeAccount: (accountId: string | null) => void;
  onAdd: (debt: Omit<Debt, 'id' | 'createdAt'>) => Promise<void>;
  onUpdate: (id: string, debt: Partial<Debt>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onPaySplit: (id: string, splitId: string) => Promise<void>;
}

type DebtsTab = 'due' | 'purchases' | 'manual';
const TABS: [DebtsTab, string][] = [
  ['due', 'Vencimentos'],
  ['purchases', 'Compras parceladas no cartão'],
  ['manual', 'Dívidas cadastradas'],
];

export function DebtsPage({ transactionsBase, debts, accounts, accountId, onChangeAccount, onAdd, onUpdate, onDelete, onPaySplit }: DebtsPageProps) {
  const [tab, setTab] = useState<DebtsTab>('due');
  const ids = accountIdsOf(accountId, accounts);
  const shownDebts = debts.filter(d => inAccounts(ids, d.accountId));
  const shownTransactions = transactionsBase.filter(t => inAccounts(ids, t.accountId));
  // Faturas em real: dívidas e parcelas desta aba são somadas em real (FIN-076).
  const billed = accounts.filter(a => a.type === 'credit' && a.pendingBill != null && currencyOf(a) === BASE_CURRENCY
    && inAccounts(ids, a.id));
  const cardBill = billed.length ? billed.reduce((s, a) => s + (a.pendingBill ?? 0), 0) : null;

  return (
    <>
      <div className="mb-6 flex flex-wrap justify-between items-end gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-white mb-1">Dívidas e parcelamentos</h1>
          <p className="text-textMuted text-sm">Compras parceladas no cartão, dívidas cadastradas e o que vence em cada mês</p>
        </div>
        <AccountFilter id="debts-account" accounts={accounts} value={accountId} onChange={onChangeAccount}/>
      </div>

      {/* As três vistas como abas de navegador. Todas ficam montadas (só escondidas) para não
          perder o mês escolhido nem um formulário aberto ao trocar de aba. */}
      <div role="tablist" aria-label="Vistas de dívidas" className="flex gap-1 overflow-x-auto border-b mb-6" style={{ borderColor: 'var(--fg-10)' }}>
        {TABS.map(([key, label]) => (
          <button key={key} id={`debts-tab-${key}`} role="tab" type="button"
            aria-selected={tab === key} aria-controls={`debts-panel-${key}`} onClick={() => setTab(key)}
            className={`-mb-px px-4 py-2 rounded-t-xl border text-sm font-medium whitespace-nowrap transition-colors ${
              tab === key ? 'text-white' : 'text-textMuted border-transparent hover:text-white hover:bg-white/5'}`}
            style={tab === key ? { backgroundColor: 'var(--fg-3)', borderColor: 'var(--fg-10)', borderBottomColor: 'transparent' } : undefined}>
            {label}
          </button>
        ))}
      </div>

      {/* FIN-094: mês de referência, vencimentos do mês e compras parceladas no cartão. */}
      <div id="debts-panel-due" role="tabpanel" aria-labelledby="debts-tab-due" hidden={tab !== 'due'}>
        <InstallmentsPanel view="due" transactions={shownTransactions} debts={shownDebts} accounts={accounts} cardBill={cardBill}/>
      </div>
      <div id="debts-panel-purchases" role="tabpanel" aria-labelledby="debts-tab-purchases" hidden={tab !== 'purchases'}>
        <InstallmentsPanel view="purchases" transactions={shownTransactions} debts={shownDebts} accounts={accounts} cardBill={cardBill}/>
      </div>
      <div id="debts-panel-manual" role="tabpanel" aria-labelledby="debts-tab-manual" hidden={tab !== 'manual'}>
        <DebtManager
          debts={shownDebts}
          onAdd={onAdd}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onPaySplit={onPaySplit}
          accounts={accounts}
        />
      </div>
    </>
  );
}
