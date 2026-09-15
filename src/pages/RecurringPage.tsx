import { RecurringManager } from '../components/RecurringManager';
import type { Account, RecurringTransaction, Transaction } from '../types';

interface RecurringPageProps {
  recurring: RecurringTransaction[];
  accounts: Account[];
  onAdd: (rec: Omit<RecurringTransaction, 'id' | 'createdAt'>) => Promise<void>;
  onUpdate: (id: string, rec: Partial<Omit<RecurringTransaction, 'id' | 'createdAt'>>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  transactionCategories: string[];
  transactions: Transaction[];
}

export function RecurringPage({
  recurring, accounts, onAdd, onUpdate, onDelete, transactionCategories, transactions,
}: RecurringPageProps) {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-1">Recorrências</h1>
        <p className="text-textMuted text-sm">Lançamentos que se repetem — salário, aluguel, assinaturas</p>
      </div>
      <RecurringManager
        recurring={recurring}
        accounts={accounts}
        onAdd={onAdd}
        onUpdate={onUpdate}
        onDelete={onDelete}
        transactionCategories={transactionCategories}
        transactions={transactions}
      />
    </>
  );
}
