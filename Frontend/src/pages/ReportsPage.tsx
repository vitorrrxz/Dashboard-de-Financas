import { ReportsView } from '../components/ReportsView';
import type { Account, Debt, Investment, NetWorthSnapshot, Transaction } from '../types';
import type { ProjectionPoint } from '../utils/projection';

interface ReportsPageProps {
  transactions: Transaction[];
  accounts: Account[];
  debts: Debt[];
  investments: Investment[];
  netWorthHistory: NetWorthSnapshot[];
  projection: ProjectionPoint[];
}

export function ReportsPage({ transactions, accounts, debts, investments, netWorthHistory, projection }: ReportsPageProps) {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-medium tracking-tight text-white mb-1">Relatórios</h1>
        <p className="text-textMuted text-sm">Patrimônio líquido, receitas e despesas e o que vem nos próximos meses</p>
      </div>
      <ReportsView
        transactions={transactions}
        accounts={accounts}
        debts={debts}
        investments={investments}
        netWorthHistory={netWorthHistory}
        projection={projection}
      />
    </>
  );
}
