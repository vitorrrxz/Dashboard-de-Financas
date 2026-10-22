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
  kind: 'expense' | 'income';
}

export function RecurringPage({
  recurring, accounts, onAdd, onUpdate, onDelete, transactionCategories, transactions, kind,
}: RecurringPageProps) {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-medium tracking-tight text-white mb-1">{kind === 'expense' ? 'Despesas Recorrentes' : 'Devedores'}</h1>
        <p className="text-textMuted text-sm">
          {kind === 'expense' ? 'Despesas que se repetem — aluguel, assinaturas, contas' : 'Receitas que se repetem — quem te paga todo mês'}
        </p>
      </div>
      <RecurringManager
        recurring={recurring}
        accounts={accounts}
        onAdd={onAdd}
        onUpdate={onUpdate}
        onDelete={onDelete}
        transactionCategories={transactionCategories}
        transactions={transactions}
        kind={kind}
      />
    </>
  );
}
