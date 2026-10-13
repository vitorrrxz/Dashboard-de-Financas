import { ReportsView } from '../components/ReportsView';
import type { Account, Debt, Investment, NetWorthSnapshot, Transaction } from '../types';

interface ReportsPageProps {
  transactions: Transaction[];
  accounts: Account[];
  debts: Debt[];
  investments: Investment[];
  netWorthHistory: NetWorthSnapshot[];
}

export function ReportsPage({ transactions, accounts, debts, investments, netWorthHistory }: ReportsPageProps) {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-1">Relatórios</h1>
        <p className="text-textMuted text-sm">Patrimônio líquido e comparativos de receitas e despesas</p>
      </div>
      <ReportsView
        transactions={transactions}
        accounts={accounts}
        debts={debts}
        investments={investments}
        netWorthHistory={netWorthHistory}
      />
    </>
  );
}
