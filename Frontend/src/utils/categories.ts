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

// Cor de cada categoria — a mesma no gráfico do Dashboard, nas transações, no orçamento e nas
// recorrências. As mais comuns têm cor fixa (escolhida para as que costumam aparecer juntas não
// repetirem); as demais, inclusive as categorias livres e as da Pluggy, saem de um hash do nome,
// então também não mudam. Transferência entre contas e pagamento de fatura não são gasto: cinza.
export const CATEGORY_PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#14b8a6', '#0ea5e9', '#3b82f6', '#8b5cf6', '#ec4899',
];
const [RED, ORANGE, AMBER, LIME, GREEN, TEAL, SKY, BLUE, VIOLET, PINK] = CATEGORY_PALETTE;
const NEUTRAL = '#94a3b8';
const FIXED_COLORS: Record<string, string> = {
  'Alimentação': ORANGE, 'Supermercado': LIME, 'Delivery de comida': RED, 'Restaurantes': RED,
  'Transporte': BLUE, 'Combustível': BLUE, 'Táxi e transporte por app': BLUE, 'Educação': SKY,
  'Lazer': AMBER, 'Moradia': AMBER, 'Saúde': TEAL, 'Compras': VIOLET, 'Serviços digitais': VIOLET,
  'Vestuário': PINK, 'Serviços': TEAL, 'Transferências': ORANGE, 'Transferência - PIX': BLUE,
  'Receita': GREEN, 'Salário': GREEN, 'Investimento automático': TEAL, 'Outros': NEUTRAL,
  'Transferência entre contas': NEUTRAL, 'Pagamento de fatura': NEUTRAL,
};

export function categoryColor(category: string): string {
  const fixed = FIXED_COLORS[category];
  if (fixed) return fixed;
  let hash = 0;
  for (const ch of category) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length];
}

/** Ponto colorido da categoria, para ir antes do nome. */
export const categoryDot = (category: string) => ({ backgroundColor: categoryColor(category) });
