import { Download, FileText, Upload } from 'lucide-react';
import { MonthNavigator, MonthTotal } from '../components/MonthNavigator';
import { AccountFilter } from '../components/AccountFilter';
import { TxTable } from '../components/TxTable';
import type { FilterOption } from '../components/ColumnFilter';
import { categoryColor } from '../utils/categories';
import { PAYMENT_TYPE_META } from '../utils/paymentTypes';
import { ALL_MONTHS } from '../utils/transactions';
import type { TransactionTotals } from '../utils/transactions';
import type { CategoryRuleDraft } from '../utils/paymentTypes';
import type { Account, Transaction } from '../types';

interface TransactionsPageProps {
  filtered: Transaction[];
  txMonth: string;
  onChangeTxMonth: (month: string) => void;
  txMonths: string[];
  monthTotals: TransactionTotals;
  hiddenInstallments: number;
  onGoToDebts: () => void;
  txFilter: 'all' | 'income' | 'expense';
  onChangeTxFilter: (filter: 'all' | 'income' | 'expense') => void;
  /** Categorias e formas de pagamento do recorte de mês e busca, com quantas transações cada. */
  categoryCounts: { value: string; count: number }[];
  txCategory: string | null;
  onChangeTxCategory: (category: string | null) => void;
  paymentTypeCounts: { value: string; count: number }[];
  txPaymentType: string | null;
  onChangeTxPaymentType: (paymentType: string | null) => void;
  /** Categorias com alguma transação — as opções do campo Categoria na edição. */
  categories: string[];
  accounts: Account[];
  /** Conta do filtro (null = todas); `filtered` e os totais já chegam recortados por ela. */
  accountId: string | null;
  onChangeAccount: (accountId: string | null) => void;
  onUpdateTransaction: (id: string, tx: Partial<Transaction>) => Promise<void>;
  onDeleteTransaction: (id: string) => Promise<void>;
  onCreateRule: (rule: CategoryRuleDraft) => Promise<void>;
  txHasMore: boolean;
  txLoadingMore: boolean;
  onLoadMore: () => void;
  onExportCSV: () => void;
  onExportPDF: () => void;
  exportingPDF: boolean;
  onShowImport: () => void;
}

const TX_FILTERS = [
  { key: 'all',     label: 'Todas' },
  { key: 'income',  label: 'Receitas' },
  { key: 'expense', label: 'Despesas' },
] as const;

const SECONDARY = 'h-9 px-3 flex items-center gap-2 rounded-md text-sm text-white bg-card border border-[var(--control)] hover:border-[var(--color-textMuted)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export function TransactionsPage({
  filtered, txMonth, onChangeTxMonth, txMonths, monthTotals, hiddenInstallments, onGoToDebts,
  txFilter, onChangeTxFilter, categoryCounts, txCategory, onChangeTxCategory,
  paymentTypeCounts, txPaymentType, onChangeTxPaymentType, categories, accounts, accountId, onChangeAccount, onUpdateTransaction, onDeleteTransaction, onCreateRule,
  txHasMore, txLoadingMore, onLoadMore, onExportCSV, onExportPDF, exportingPDF, onShowImport,
}: TransactionsPageProps) {
  // O valor escolhido continua na lista mesmo se o novo mês não tiver nenhuma — senão não
  // haveria como desmarcá-lo.
  const withSelected = (counts: { value: string; count: number }[], selected: string | null) =>
    selected && !counts.some(c => c.value === selected) ? [...counts, { value: selected, count: 0 }] : counts;
  const categoryOptions: FilterOption[] = withSelected(categoryCounts, txCategory)
    .map(c => ({ value: c.value, label: c.value, count: c.count, dot: categoryColor(c.value) }));
  const paymentTypeOptions: FilterOption[] = withSelected(paymentTypeCounts, txPaymentType)
    .map(c => ({ value: c.value, label: PAYMENT_TYPE_META[c.value]?.label ?? c.value, count: c.count }));

  return (
    <>
      <div className="mb-6 flex flex-wrap justify-between items-end gap-3">
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-white mb-1">Transações</h1>
          <p className="text-textMuted text-sm">{filtered.length === 1 ? '1 transação' : `${filtered.length.toLocaleString('pt-BR')} transações`} no recorte</p>
        </div>
        <div className="flex gap-2">
          {/* FIN-060/FIN-061: exportam exatamente o recorte visível (busca + filtro). */}
          <button onClick={onExportCSV} disabled={filtered.length === 0}
            title={filtered.length === 0 ? 'Nenhuma transação para exportar' : 'Exportar as transações filtradas em CSV'}
            className={SECONDARY}>
            <Download size={14}/> CSV
          </button>
          <button onClick={onExportPDF} disabled={filtered.length === 0 || exportingPDF}
            title={filtered.length === 0 ? 'Nenhuma transação para exportar' : 'Exportar as transações filtradas em PDF'}
            className={SECONDARY}>
            <FileText size={14}/> {exportingPDF ? 'Gerando...' : 'PDF'}
          </button>
          <button onClick={onShowImport}
            className="h-9 px-4 flex items-center gap-2 rounded-md text-sm text-on-accent font-medium bg-primary hover:opacity-90 transition-opacity">
            <Upload size={14}/> Importar extrato
          </button>
        </div>
      </div>

      {/* FIN-093: mês de referência + total do recorte. Fica acima dos filtros de
          tipo porque delimita o conjunto sobre o qual eles atuam. */}
      <div className="panel rounded-2xl p-4 mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <MonthNavigator id="tx-month" value={txMonth} months={txMonths} onChange={onChangeTxMonth} allowAll/>
          <AccountFilter id="tx-account" accounts={accounts} value={accountId} onChange={onChangeAccount}/>
        </div>

        <div className="flex flex-wrap items-end gap-6">
          <MonthTotal label="Receitas" value={monthTotals.income} color="var(--color-textMain)"/>
          <MonthTotal label="Despesas" value={monthTotals.expense} color="var(--text-negative)"/>
          <MonthTotal label="Valor total" value={monthTotals.balance} signed
            color={monthTotals.balance > 0 ? 'var(--text-positive)' : monthTotals.balance < 0 ? 'var(--text-negative)' : 'var(--color-textMuted)'}/>
        </div>
      </div>

      {/* FIN-094: os parcelados não aparecem nesta aba — em vez de sumir com eles, avisa
          quantos ficaram de fora e leva direto para a aba onde estão. */}
      {hiddenInstallments > 0 && (
        <p className="text-xs text-textMuted -mt-2 mb-5">
          {hiddenInstallments} {hiddenInstallments === 1 ? 'lançamento parcelado' : 'lançamentos parcelados'}
          {txMonth === ALL_MONTHS ? '' : ' deste mês'} {hiddenInstallments === 1 ? 'está' : 'estão'} em{' '}
          <button type="button" onClick={onGoToDebts}
            className="text-white font-medium underline underline-offset-2 hover:no-underline">
            Dívidas e parcelamentos
          </button>.
        </p>
      )}
      <div className="panel rounded-2xl p-5 md:p-6">
        <div role="group" aria-label="Receitas ou despesas" className="inline-flex p-0.5 rounded-md bg-white/[0.06] mb-4">
          {TX_FILTERS.map(f => (
            <button key={f.key} type="button" aria-pressed={txFilter === f.key} onClick={() => onChangeTxFilter(f.key)}
              className={`h-7 px-3 text-sm rounded transition-colors ${txFilter === f.key ? 'bg-card text-white font-medium' : 'text-textMuted hover:text-white'}`}>
              {f.label}
            </button>
          ))}
        </div>
        {/* Com filtro de coluna ativo a tabela fica, mesmo vazia, para o filtro poder ser desfeito no cabeçalho. */}
        {filtered.length === 0 && !txCategory && !txPaymentType ? (
          <p className="text-sm text-textMuted py-3 px-3 rounded-md border border-dashed border-[var(--control)]">Nenhuma transação neste recorte.</p>
        ) : (
          <TxTable
            rows={filtered.slice(0, 200)}
            accounts={accounts}
            categories={categories}
            onUpdate={onUpdateTransaction}
            onDelete={onDeleteTransaction}
            onCreateRule={onCreateRule}
            categoryFilter={{ options: categoryOptions, value: txCategory, onChange: onChangeTxCategory }}
            typeFilter={{ options: paymentTypeOptions, value: txPaymentType, onChange: onChangeTxPaymentType }}
          />
        )}
      </div>

      {/* FIN-023: a carga inicial busca no máximo 2000 transações — este botão só
          aparece quando esse limite foi atingido, permitindo acessar o restante. */}
      {txHasMore && (
        <button onClick={onLoadMore} disabled={txLoadingMore}
          className={`${SECONDARY} w-full justify-center mt-3`}>
          {txLoadingMore ? 'Carregando...' : 'Carregar transações mais antigas'}
        </button>
      )}
    </>
  );
}
