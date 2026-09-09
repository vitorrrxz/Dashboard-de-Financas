// Categorias conhecidas de transação e sua cor de exibição — antes vivia só como uma
// constante local em App.tsx; movida para um módulo compartilhado para que o Orçamento
// (FIN-045, que precisa da mesma lista para o seletor de categoria) não precise duplicá-la
// nem importar de App.tsx (o que criaria um import circular, já que App.tsx importa o
// componente de Orçamento).
export const CATEGORY_COLORS: Record<string, string> = {
  'Alimentação': '#f59e0b', 'Transporte': '#3b82f6', 'Lazer': '#a855f7',
  'Moradia': '#6366f1', 'Saúde': '#10b981', 'Educação': '#06b6d4',
  'Compras': '#ec4899', 'Receita': '#14b8a6', 'Outros': '#6b7280',
};

// Categorias de despesa (exclui "Receita") — usadas onde só faz sentido categorizar
// gastos, como o seletor de categoria do Orçamento (FIN-045): um orçamento para a
// categoria "Receita" não teria significado de negócio.
export const EXPENSE_CATEGORIES = Object.keys(CATEGORY_COLORS).filter(c => c !== 'Receita');
