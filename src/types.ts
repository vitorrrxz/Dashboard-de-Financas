// Shared types for the finance dashboard

export type PaymentType = 'debit' | 'credit' | 'pix' | 'pix_installment';

export interface Transaction {
  id: string;
  name: string;
  category: string;
  date: string;
  amount: number;
  accountId?: string;    // Link to an Account
  paymentType?: PaymentType;
  externalId?: string;   // FITID do OFX (identificador estável do banco) — ver computeImportHash em server.js
}

export type AccountType = 'checking' | 'savings' | 'credit' | 'investment' | 'cash';

export interface Account {
  id: string;
  name: string;
  bank: string;
  type: AccountType;
  balance: number;
  limit?: number;        // for credit cards
  dueDay?: number;       // billing due day (for credit cards)
  closingDay?: number;   // bill closing day (for credit cards)
  pendingBill?: number;  // manually entered pending invoice amount
  color: string;
}

export type DebtCategory = 'Empréstimo' | 'Financiamento' | 'Cartão de Crédito' | 'Pessoal' | 'Outros';

export interface DebtItem {
  id: string;
  name: string;
  amount: number;
  date: string;
}

export interface Debt {
  id: string;
  name: string;
  description?: string;
  category: DebtCategory;
  totalAmount: number;
  paidAmount: number;
  monthlyPayment: number;
  totalInstallments: number;
  paidInstallments: number;
  nextDueDate: string;   // ISO date
  interestRate?: number; // % per month
  createdAt: string;
  subItems?: DebtItem[]; // Items from CSV import
  accountId?: string;    // Link to an Account
}

// FIN-042 — orçamento mensal por categoria (Fase 3). `category` é texto livre, casando
// com `Transaction.category` (que também não é um enum fechado — ver CATEGORY_COLORS
// em App.tsx e CATEGORY_RULES em parsers.ts).
export interface Budget {
  id: string;
  category: string;
  monthlyLimit: number;
  createdAt: string;
}

// FIN-049 — meta financeira (Fase 4). `currentAmount` é o quanto já foi acumulado; o
// progresso exibido na tela é derivado dele com `targetAmount` (ver GoalsManager.tsx).
export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string;   // ISO date
  createdAt: string;
}

// FIN-053 — transação recorrente (Fase 4). A frequência vem de `utils/dates.ts`, onde
// mora a lógica de avanço de ocorrência, para não ter duas listas de frequências.
export type { RecurrenceFrequency } from './utils/dates';

export interface RecurringTransaction {
  id: string;
  name: string;
  category: string;
  amount: number;        // negativo = despesa, positivo = receita (igual a Transaction)
  frequency: import('./utils/dates').RecurrenceFrequency;
  nextOccurrence: string; // ISO date — ponteiro de até onde já foi lançado
  active: boolean;
  accountId?: string;
  createdAt: string;
}

// FIN-065/FIN-066 — notificação da central do sino. `AppNotification`, e não `Notification`,
// para não colidir com a API de notificações do navegador (`window.Notification`).
export type NotificationType = 'debt_due' | 'debt_overdue' | 'bill_due' | 'unusual_spending';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  createdAt: string; // ISO date-time
}
