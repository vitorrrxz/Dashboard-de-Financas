import { AccountsManager } from '../components/AccountsManager';
import type { ExchangeRates } from '../utils/currency';
import type { Account } from '../types';

interface AccountsPageProps {
  accounts: Account[];
  onAdd: (acc: Omit<Account, 'id' | 'createdAt'>) => Promise<void>;
  onUpdate: (id: string, acc: Omit<Account, 'id' | 'createdAt'>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  rates: ExchangeRates | null;
}

export function AccountsPage({ accounts, onAdd, onUpdate, onDelete, rates }: AccountsPageProps) {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-1">Contas e Cartões</h1>
        <p className="text-textMuted text-sm">Seu saldo real e faturas pendentes</p>
      </div>
      <AccountsManager
        accounts={accounts}
        onAdd={onAdd}
        onUpdate={onUpdate}
        onDelete={onDelete}
        rates={rates}
      />
    </>
  );
}
