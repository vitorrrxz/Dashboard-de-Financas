import { InvestmentsManager } from '../components/InvestmentsManager';
import type { ExchangeRates } from '../utils/currency';
import type { Account, Investment, InvestmentInput } from '../types';

interface InvestmentsPageProps {
  investments: Investment[];
  accounts: Account[];
  onAdd: (inv: InvestmentInput) => Promise<void>;
  onUpdate: (id: string, inv: InvestmentInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  rates: ExchangeRates | null;
}

export function InvestmentsPage({ investments, accounts, onAdd, onUpdate, onDelete, rates }: InvestmentsPageProps) {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-1">Investimentos</h1>
        <p className="text-textMuted text-sm">Quanto você aplicou, quanto vale hoje e como a carteira está distribuída</p>
      </div>
      <InvestmentsManager
        investments={investments}
        accounts={accounts}
        onAdd={onAdd}
        onUpdate={onUpdate}
        onDelete={onDelete}
        rates={rates}
      />
    </>
  );
}
