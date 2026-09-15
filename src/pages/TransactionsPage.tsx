import { Download, FileText, Upload } from 'lucide-react';
import { MonthNavigator, MonthTotal } from '../components/MonthNavigator';
import { TxTable } from '../components/TxTable';
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
  accounts: Account[];
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
  { key: 'all',     label: 'Todas',     color: 'rgba(99,102,241,0.15)',  border: 'rgba(99,102,241,0.4)',  text: 'var(--text-indigo)' },
  { key: 'income',  label: '↑ Receitas', color: 'rgba(20,184,166,0.12)', border: 'rgba(20,184,166,0.4)', text: 'var(--text-positive)' },
  { key: 'expense', label: '↓ Despesas', color: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.4)',  text: 'var(--text-negative)' },
] as const;

export function TransactionsPage({
  filtered, txMonth, onChangeTxMonth, txMonths, monthTotals, hiddenInstallments, onGoToDebts,
  txFilter, onChangeTxFilter, accounts, onUpdateTransaction, onDeleteTransaction, onCreateRule,
  txHasMore, txLoadingMore, onLoadMore, onExportCSV, onExportPDF, exportingPDF, onShowImport,
}: TransactionsPageProps) {
  return (
    <>
      <div className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">Transações</h1>
          <p className="text-textMuted text-sm">{filtered.length} registros</p>
        </div>
        <div className="flex gap-2">
          {/* FIN-060/FIN-061: exportam exatamente o recorte visível (busca + filtro). */}
          <button onClick={onExportCSV} disabled={filtered.length === 0}
            title={filtered.length === 0 ? 'Nenhuma transação para exportar' : 'Exportar as transações filtradas em CSV'}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-white/10 text-textMuted hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <Download size={15}/> CSV
          </button>
          <button onClick={onExportPDF} disabled={filtered.length === 0 || exportingPDF}
            title={filtered.length === 0 ? 'Nenhuma transação para exportar' : 'Exportar as transações filtradas em PDF'}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-white/10 text-textMuted hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <FileText size={15}/> {exportingPDF ? 'Gerando...' : 'PDF'}
          </button>
          <button onClick={onShowImport}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-on-accent font-medium transition-colors"
            style={{ backgroundColor:'var(--color-primary)' }}>
            <Upload size={15}/> Importar
          </button>
        </div>
      </div>

      {/* FIN-093: mês de referência + total do recorte. Fica acima dos filtros de
          tipo porque delimita o conjunto sobre o qual eles atuam. */}
      <div className="glass-card rounded-2xl p-4 mb-5 flex flex-wrap items-end justify-between gap-4">
        <MonthNavigator id="tx-month" value={txMonth} months={txMonths} onChange={onChangeTxMonth} allowAll/>

        <div className="flex flex-wrap items-end gap-6">
          <MonthTotal label="Receitas" value={monthTotals.income} color="var(--color-accent)"/>
          <MonthTotal label="Despesas" value={monthTotals.expense} color="var(--text-negative)"/>
          <MonthTotal label="Valor total" value={monthTotals.balance} signed
            color={monthTotals.balance >= 0 ? 'var(--color-textMain)' : 'var(--text-negative)'}/>
        </div>
      </div>

      {/* FIN-094: os parcelados não aparecem nesta aba — em vez de sumir com eles, avisa
          quantos ficaram de fora e leva direto para a aba onde estão. */}
      {hiddenInstallments > 0 && (
        <p className="text-xs text-textMuted -mt-2 mb-5">
          {hiddenInstallments} {hiddenInstallments === 1 ? 'lançamento parcelado' : 'lançamentos parcelados'}
          {txMonth === ALL_MONTHS ? '' : ' deste mês'} {hiddenInstallments === 1 ? 'está' : 'estão'} em{' '}
          <button type="button" onClick={onGoToDebts}
            className="text-primary font-medium hover:underline">
            Dívidas e Parcelamentos
          </button>.
        </p>
      )}
      <div className="flex gap-2 mb-5">
        {TX_FILTERS.map(f => (
          <button key={f.key} onClick={() => onChangeTxFilter(f.key)}
            className="px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200"
            style={{
              backgroundColor: txFilter === f.key ? f.color : 'var(--fg-4)',
              borderColor: txFilter === f.key ? f.border : 'var(--fg-8)',
              color: txFilter === f.key ? f.text : 'var(--color-textMuted)',
              borderWidth: 1
            }}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="glass-card rounded-2xl p-6">
        {filtered.length === 0 ? (
          <p className="text-center text-textMuted py-12 text-sm">Nenhuma transação encontrada.</p>
        ) : (
          <TxTable
            rows={filtered.slice(0, 200)}
            accounts={accounts}
            onUpdate={onUpdateTransaction}
            onDelete={onDeleteTransaction}
            onCreateRule={onCreateRule}
          />
        )}
      </div>

      {/* FIN-023: a carga inicial busca no máximo 2000 transações — este botão só
          aparece quando esse limite foi atingido, permitindo acessar o restante. */}
      {txHasMore && (
        <button onClick={onLoadMore} disabled={txLoadingMore}
          className="w-full mt-4 py-3 rounded-xl border border-white/10 text-sm text-textMuted hover:text-white hover:bg-white/5 transition-all disabled:opacity-50">
          {txLoadingMore ? 'Carregando...' : 'Carregar transações mais antigas'}
        </button>
      )}
    </>
  );
}
