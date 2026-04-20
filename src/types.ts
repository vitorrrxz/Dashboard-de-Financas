// Shared types for the finance dashboard

export interface Transaction {
  id: string;
  name: string;
  category: string;
  date: string;
  amount: number;
  accountId?: string; // Link to an Account
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
