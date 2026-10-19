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
}

export function DebtsPage({ transactionsBase, debts, accounts, accountId, onChangeAccount, onAdd, onUpdate, onDelete }: DebtsPageProps) {
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
          <h1 className="text-3xl font-bold text-white mb-1">Dívidas e Parcelamentos</h1>
          <p className="text-textMuted text-sm">Compras parceladas no cartão, dívidas cadastradas e o que vence em cada mês</p>
        </div>
        <AccountFilter id="debts-account" accounts={accounts} value={accountId} onChange={onChangeAccount}/>
      </div>
      {/* FIN-094: mês de referência, vencimentos do mês e compras parceladas no cartão. */}
      <InstallmentsPanel transactions={shownTransactions} debts={shownDebts} accounts={accounts} cardBill={cardBill}/>
      <DebtManager
        debts={shownDebts}
        onAdd={onAdd}
        onUpdate={onUpdate}
        onDelete={onDelete}
        accounts={accounts}
      />
    </>
  );
}
