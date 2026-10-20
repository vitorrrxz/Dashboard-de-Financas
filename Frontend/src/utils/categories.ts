import type { Transaction } from '../types';

// Categorias conhecidas de transação — compartilhadas pelo seletor da tabela, pelo Orçamento
// (FIN-045), pelas recorrências e pelas regras de categoria. Sem cor por categoria: na lista, uma
// cor por linha vira arco-íris e não diz nada; a categoria é lida pelo nome.
export const CATEGORIES = [
  'Alimentação', 'Transporte', 'Lazer', 'Moradia', 'Saúde', 'Educação', 'Compras', 'Receita', 'Outros',
  'Transferência entre contas', 'Pagamento de fatura',
];

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
export const EXPENSE_CATEGORIES = CATEGORIES.filter(c => c !== 'Receita' && !OWN_TRANSFER_CATEGORIES.includes(c));
