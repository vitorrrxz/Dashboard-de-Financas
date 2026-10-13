import { BudgetManager } from '../components/BudgetManager';
import type { BudgetProgress } from '../utils/budget';
import type { Budget } from '../types';

interface BudgetsPageProps {
  budgetProgress: BudgetProgress[];
  onAdd: (budget: Omit<Budget, 'id' | 'createdAt'>) => Promise<void>;
  onUpdate: (id: string, budget: Omit<Budget, 'id' | 'createdAt'>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  existingCategories: string[];
  transactionCategories: string[];
}

export function BudgetsPage({ budgetProgress, onAdd, onUpdate, onDelete, existingCategories, transactionCategories }: BudgetsPageProps) {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-1">Orçamento</h1>
        <p className="text-textMuted text-sm">Limite de gasto mensal por categoria</p>
      </div>
      <BudgetManager
        budgetProgress={budgetProgress}
        onAdd={onAdd}
        onUpdate={onUpdate}
        onDelete={onDelete}
        existingCategories={existingCategories}
        transactionCategories={transactionCategories}
      />
    </>
  );
}
