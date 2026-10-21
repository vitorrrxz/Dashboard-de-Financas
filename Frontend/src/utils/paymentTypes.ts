// Rótulo de cada forma de pagamento — usado pela coluna Tipo de `TxTable` e pelo relatório de
// transações (CSV/PDF) em `App.tsx`. Módulo próprio (e não dentro de `TxTable.tsx`) porque um
// arquivo de componente só pode exportar componentes (react-refresh/only-export-components).
export const PAYMENT_TYPE_META: Record<string, { label: string }> = {
  debit:           { label: 'Débito' },
  credit:          { label: 'Crédito' },
  pix:             { label: 'PIX' },
  pix_installment: { label: 'PIX Parc.' },
};

/** FIN-106 — regra de categoria nascida da correção de uma transação (ver `createCategoryRule` em App.tsx). */
export interface CategoryRuleDraft { match: string; category: string; applyToExisting: boolean }
