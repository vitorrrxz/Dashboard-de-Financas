import { GoalsManager } from '../components/GoalsManager';
import type { Account, Goal, Investment } from '../types';

interface GoalsPageProps {
  goals: Goal[];
  accounts: Account[];
  investments: Investment[];
  onAdd: (goal: Omit<Goal, 'id' | 'createdAt'>) => Promise<void>;
  onUpdate: (id: string, goal: Omit<Goal, 'id' | 'createdAt'>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function GoalsPage({ goals, accounts, investments, onAdd, onUpdate, onDelete }: GoalsPageProps) {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-1">Metas</h1>
        <p className="text-textMuted text-sm">Quanto você quer juntar e até quando</p>
      </div>
      <GoalsManager
        goals={goals}
        accounts={accounts}
        investments={investments}
        onAdd={onAdd}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />
    </>
  );
}
