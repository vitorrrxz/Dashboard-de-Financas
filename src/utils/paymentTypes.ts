// Rótulo e cor de cada forma de pagamento — usado pelo badge de `TxTable` e pelo relatório de
// transações (CSV/PDF) em `App.tsx`. Módulo próprio (e não dentro de `TxTable.tsx`) porque um
// arquivo de componente só pode exportar componentes (react-refresh/only-export-components).
export const PAYMENT_TYPE_META: Record<string, { label: string; color: string }> = {
  debit:           { label: 'Débito',       color: '#3b82f6' },
  credit:          { label: 'Crédito',      color: '#ec4899' },
  pix:             { label: 'PIX',          color: '#10b981' },
  pix_installment: { label: 'PIX Parc.',    color: '#f59e0b' },
};

/** FIN-106 — regra de categoria nascida da correção de uma transação (ver `createCategoryRule` em App.tsx). */
export interface CategoryRuleDraft { match: string; category: string; applyToExisting: boolean }
