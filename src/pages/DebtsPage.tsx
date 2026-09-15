import { InstallmentsPanel } from '../components/InstallmentsPanel';
import { DebtManager } from '../components/DebtManager';
import type { Account, Debt, Transaction } from '../types';

interface DebtsPageProps {
  transactionsBase: Transaction[];
  debts: Debt[];
  accounts: Account[];
  onAdd: (debt: Omit<Debt, 'id' | 'createdAt'>) => Promise<void>;
  onUpdate: (id: string, debt: Partial<Debt>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function DebtsPage({ transactionsBase, debts, accounts, onAdd, onUpdate, onDelete }: DebtsPageProps) {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-1">Dívidas e Parcelamentos</h1>
        <p className="text-textMuted text-sm">Compras parceladas no cartão, dívidas cadastradas e o que vence em cada mês</p>
      </div>
      {/* FIN-094: mês de referência, vencimentos do mês e compras parceladas no cartão. */}
      <InstallmentsPanel transactions={transactionsBase} debts={debts} accounts={accounts}/>
      <DebtManager
        debts={debts}
        onAdd={onAdd}
        onUpdate={onUpdate}
        onDelete={onDelete}
        accounts={accounts}
      />
    </>
  );
}
