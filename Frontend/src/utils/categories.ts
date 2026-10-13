import type { Transaction } from '../types';

// Categorias conhecidas de transação e sua cor de exibição — antes vivia só como uma
// constante local em App.tsx; movida para um módulo compartilhado para que o Orçamento
// (FIN-045, que precisa da mesma lista para o seletor de categoria) não precise duplicá-la
// nem importar de App.tsx (o que criaria um import circular, já que App.tsx importa o
// componente de Orçamento).
export const CATEGORY_COLORS: Record<string, string> = {
  'Alimentação': '#f59e0b', 'Transporte': '#3b82f6', 'Lazer': '#a855f7',
  'Moradia': '#6366f1', 'Saúde': '#10b981', 'Educação': '#06b6d4',
  'Compras': '#ec4899', 'Receita': '#14b8a6', 'Outros': '#6b7280',
  'Transferência entre contas': '#64748b', 'Pagamento de fatura': '#78716c',
};

// FIN-103 — dinheiro que só muda de uma conta sua para outra, e o pagamento da fatura (cujas
// compras já contam uma a uma): nem receita nem despesa. As duas primeiras servem para marcar à
// mão, no modal de edição; as outras são as categorias com que a Pluggy já identifica esses
// lançamentos. O server.js repete a lista para os alertas de gasto (FIN-069), e um teste confere
// as duas.
export const OWN_TRANSFER_CATEGORIES = [
  'Transferência entre contas', 'Pagamento de fatura', 'Credit card payment', 'Same person transfer', 'Transfer - Internal',
];
export const isOwnTransfer = (t: Pick<Transaction, 'category'>) => OWN_TRANSFER_CATEGORIES.includes(t.category);

// Categorias de despesa (sem "Receita" nem as transferências de FIN-103) — usadas onde só faz sentido categorizar
// gastos, como o seletor de categoria do Orçamento (FIN-045): um orçamento para a
// categoria "Receita" não teria significado de negócio.
export const EXPENSE_CATEGORIES = Object.keys(CATEGORY_COLORS).filter(c => c !== 'Receita' && !OWN_TRANSFER_CATEGORIES.includes(c));
