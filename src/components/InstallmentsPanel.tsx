import { useMemo, useState } from 'react';
import { CreditCard, Landmark } from 'lucide-react';
import type { Account, Debt, Transaction } from '../types';
import { todayISO } from '../utils/debts';
import { formatDateBR, formatMonthLabel } from '../utils/dates';
import { formatBRL } from '../utils/money';
import {
  dueItemsInMonth, dueMonths, groupInstallmentPurchases, summarizeDueItems,
  type DueItem, type InstallmentPurchase,
} from '../utils/installments';
import { MonthNavigator, MonthTotal } from './MonthNavigator';

interface InstallmentsPanelProps {
  transactions: Transaction[];
  debts: Debt[];
  accounts: Account[];
}

/** Mesma cor da categoria "Cartão de Crédito" no DebtManager. */
const CARD_COLOR = '#ec4899';
const DEBT_COLOR = '#f59e0b';
const DONE_COLOR = '#14b8a6';

/**
 * Parte superior da aba Dívidas (FIN-094): mês de referência com o valor total a pagar no
 * mês, a lista de vencimentos desse mês e as compras parceladas no cartão, reagrupadas a
 * partir das parcelas que chegam como transações (ver `utils/installments.ts`).
 *
 * As compras parceladas são somente leitura: a fonte da verdade é o extrato do cartão, e
 * editá-las aqui divergiria do que a próxima sincronização traria.
 */
export function InstallmentsPanel({ transactions, debts, accounts }: InstallmentsPanelProps) {
  const today = todayISO();
  const currentMonth = today.slice(0, 7);
  const [month, setMonth] = useState(currentMonth);

  const purchases = useMemo(() => groupInstallmentPurchases(transactions, today), [transactions, today]);
  const months = useMemo(() => dueMonths(purchases, debts, currentMonth), [purchases, debts, currentMonth]);
  const items = useMemo(() => dueItemsInMonth(purchases, debts, month), [purchases, debts, month]);
  const totals = useMemo(() => summarizeDueItems(items), [items]);

  const activeCount = purchases.filter(p => p.nextDate !== null).length;
  const accountName = (id?: string) => accounts.find(a => a.id === id)?.name;

  return (
    <div className="space-y-6 mb-10">
      {/* Mês de referência + valor total a pagar no mês */}
      <div className="glass-card rounded-2xl p-4 flex flex-wrap items-end justify-between gap-4">
        <MonthNavigator id="debt-month" value={month} months={months} onChange={setMonth}/>
        <div className="flex flex-wrap items-end gap-6">
          <MonthTotal label="Parcelas do cartão" value={totals.card} color={CARD_COLOR}/>
          <MonthTotal label="Dívidas" value={totals.debt} color={DEBT_COLOR}/>
          <MonthTotal label="Valor total" value={totals.total} color="#ffffff"/>
        </div>
      </div>

      {/* Vencimentos do mês */}
      <section className="glass-card rounded-2xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Vencimentos de {formatMonthLabel(month)}</h3>
        {items.length === 0 ? (
          <p className="text-center text-textMuted py-8 text-sm">Nenhuma parcela neste mês.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-textMuted">
                  <th className="pb-3 font-semibold">Data</th>
                  <th className="pb-3 font-semibold">Descrição</th>
                  <th className="pb-3 font-semibold">Parcela</th>
                  <th className="pb-3 font-semibold">Situação</th>
                  <th className="pb-3 font-semibold text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-white/5">
                {items.map(item => <DueRow key={item.key} item={item} today={today}/>)}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Compras parceladas no cartão */}
      <section>
        <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
          <h3 className="text-lg font-semibold text-white">Compras parceladas no cartão</h3>
          {purchases.length > 0 && (
            <p className="text-xs text-textMuted">
              {activeCount} em andamento · {purchases.length - activeCount} concluída(s)
            </p>
          )}
        </div>
        {purchases.length === 0 ? (
          <div className="glass-card rounded-xl p-8 text-center text-sm text-textMuted">
            Nenhuma compra parcelada encontrada nas transações do cartão.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {purchases.map(p => <PurchaseCard key={p.key} purchase={p} accountName={accountName(p.accountId)}/>)}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Situação de uma parcela na lista do mês. Parcela de cartão "lançada" é a que já está numa
 * fatura (data até hoje); se essa fatura foi paga, só o extrato da conta corrente diz. Parcela
 * de dívida com data passada e ainda no cronograma está, por definição, vencida.
 */
function dueStatus(item: DueItem, today: string): { label: string; className: string } {
  if (item.source === 'card') {
    return item.date <= today
      ? { label: 'Lançada na fatura', className: 'text-textMuted' }
      : { label: 'A lançar', className: 'text-pink-300' };
  }
  return item.date < today
    ? { label: 'Vencida', className: 'text-red-400' }
    : { label: 'A vencer', className: 'text-amber-300' };
}

/** Linha da lista de vencimentos do mês. */
function DueRow({ item, today }: { item: DueItem; today: string }) {
  const status = dueStatus(item, today);
  const Icon = item.source === 'card' ? CreditCard : Landmark;
  return (
    <tr className="hover:bg-white/[0.02] transition-colors">
      <td className="py-3 text-textMuted whitespace-nowrap">{formatDateBR(item.date, { day: '2-digit', month: '2-digit' })}</td>
      <td className="py-3 text-white">
        <span className="inline-flex items-center gap-2">
          <Icon size={13} aria-hidden="true" style={{ color: item.source === 'card' ? CARD_COLOR : DEBT_COLOR }}/>
          {item.name}
        </span>
      </td>
      <td className="py-3 text-textMuted whitespace-nowrap">
        {item.number}/{item.totalInstallments}
        {item.estimated && (
          <span className="ml-2 text-[10px] uppercase tracking-wider opacity-70"
            title="Parcela deduzida: não veio nos dados sincronizados">estimada</span>
        )}
      </td>
      <td className="py-3"><span className={`text-xs font-medium ${status.className}`}>{status.label}</span></td>
      <td className="py-3 text-right font-semibold text-white whitespace-nowrap">{formatBRL(item.amount)}</td>
    </tr>
  );
}

/** Célula de valor do card de compra parcelada. */
function InfoCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg p-2.5" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
      <p className="text-xs text-textMuted mb-0.5">{label}</p>
      <p className="text-sm font-bold" style={{ color: color ?? '#ffffff' }}>{value}</p>
    </div>
  );
}

/** Card de uma compra parcelada: progresso das parcelas lançadas e valores restantes. */
function PurchaseCard({ purchase: p, accountName }: { purchase: InstallmentPurchase; accountName?: string }) {
  const done = p.nextDate === null;
  const pct = p.totalInstallments > 0 ? (p.chargedInstallments / p.totalInstallments) * 100 : 0;
  const estimatedCount = p.installments.filter(i => i.estimated).length;
  const lastDate = p.installments[p.installments.length - 1].date;
  const barColor = done ? DONE_COLOR : CARD_COLOR;

  return (
    <div className="glass-card rounded-xl p-5" style={{ borderLeft: `3px solid ${barColor}` }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-white truncate" title={p.name}>{p.name}</h4>
          <p className="text-xs text-textMuted mt-0.5">{[accountName, p.category].filter(Boolean).join(' · ')}</p>
        </div>
        {done && <span className="text-xs px-2 py-0.5 rounded-full bg-accent/20 text-accent shrink-0">Concluída</span>}
      </div>

      <div className="mb-3">
        <div className="flex justify-between text-xs text-textMuted mb-1.5">
          <span>{p.chargedInstallments}/{p.totalInstallments} parcelas lançadas</span>
          <span>{pct.toFixed(0)}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.07)' }}
          role="progressbar" aria-valuemin={0} aria-valuemax={p.totalInstallments} aria-valuenow={p.chargedInstallments}
          aria-label={`${p.chargedInstallments} de ${p.totalInstallments} parcelas lançadas`}>
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: barColor }}/>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <InfoCell label="Parcela" value={formatBRL(p.installmentAmount)} color={CARD_COLOR}/>
        <InfoCell label="Restante" value={formatBRL(p.remainingAmount)}/>
        <InfoCell label={done ? 'Última' : 'Próxima'}
          value={formatDateBR(p.nextDate ?? lastDate, { day: '2-digit', month: '2-digit', year: '2-digit' })}/>
      </div>

      <p className="text-[11px] text-textMuted mt-3">
        Total da compra: {formatBRL(p.totalAmount)}
        {estimatedCount > 0 && ` · ${estimatedCount} parcela(s) estimada(s)`}
      </p>
    </div>
  );
}
