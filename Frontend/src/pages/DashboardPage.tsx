import { memo, useCallback, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Plus, Upload, X } from 'lucide-react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, ReferenceLine,
} from 'recharts';
import { describeConversion, type ExchangeRates } from '../utils/currency';
import { describeHoldings, type InvestmentHoldings } from '../utils/investments';
import type { BudgetProgress } from '../utils/budget';
import type { ProjectionPoint } from '../utils/projection';
import type { ByPaymentType, FinancialStats } from '../hooks/useFinancialStats';
import type { Account, ExtraIncome, Salary, SalaryFrequency } from '../types';
import type { Tab } from '../App';
import { AccountOptions } from '../components/AccountFilter';
import { FormField } from '../components/shared/FormField';
import { MonthNavigator } from '../components/MonthNavigator';
import { biweeklyLeftovers, extrasInMonth, salaryPerMonth, sumExtras } from '../utils/salary';
import { dateInMonth, daysInMonth, formatMonthLabel } from '../utils/dates';
import { balanceTone, formatBRL } from '../utils/money';
import { HIDDEN_VALUE, valuesHidden } from '../utils/privacy';
import { categoryColor, categoryDot } from '../utils/categories';
import { niceTicks } from '../utils/chart';
import { useChartAnimation } from '../hooks/useMediaQuery';

/** "R$ 1.234,56" com espaço que não quebra: o valor nunca se separa do símbolo numa linha estreita. */
const fmt = (v: number) => formatBRL(v).replace(' ', ' ');
/** Valor com sinal: "−R$ 12,00" quando negativo — o sinal mora no texto, não só na cor. */
const signed = (v: number) => `${v < 0 ? '−' : ''}${fmt(v)}`;
/** Eixo em milhares: "2 mil", "−1,5 mil". */
const axisMoney = (v: number) => (v === 0 ? '0' : valuesHidden() ? HIDDEN_VALUE : `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`);

/** Atualização de estado que escolhe `name`, ou desfaz a escolha se ele já estava escolhido. */
const togglingTo = (name: string) => (current: string | null) => (current === name ? null : name);

type CategorySlice = FinancialStats['expenseByCategoryByMonth'][string][number];

/**
 * Anel do "Gastos por categoria". Fica isolado e memoizado de propósito: o Recharts recria as
 * fatias a cada render do <Pie> (a chave da animação muda junto com as props), o que mataria a
 * transição do destaque e perderia o mouseleave da fatia. O destaque vem de fora, só por CSS
 * (as classes `cat-slice-N`), então passar o mouse não re-renderiza o gráfico.
 */
const CategoryDonut = memo(function CategoryDonut({ data, animation, onHover, onPick }: {
  data: CategorySlice[];
  animation: ReturnType<typeof useChartAnimation>;
  onHover: (name: string | null) => void;
  onPick: Dispatch<SetStateAction<string | null>>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%" className="[&_*]:outline-none">
      <PieChart>
        {/* O anel não vai até a borda (92%): sobra espaço para a fatia destacada crescer. */}
        <Pie data={data} dataKey="amount" nameKey="name"
          innerRadius="74%" outerRadius="92%" paddingAngle={1.5} stroke="none" {...animation} startAngle={90} endAngle={-270}
          onMouseEnter={(_, i) => onHover(data[i]?.name ?? null)}
          onMouseLeave={() => onHover(null)}
          onClick={(_, i) => { const name = data[i]?.name; if (name) onPick(togglingTo(name)); }}>
          {data.map((e, i) => (
            <Cell key={e.name} fill={categoryColor(e.name)}
              className={`cat-slice cat-slice-${i} cursor-pointer [transform-box:view-box] origin-center transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none`}/>
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
});

const tooltipStyle = {
  contentStyle: { backgroundColor: 'var(--tooltip-bg)', border: '1px solid var(--tooltip-border)', borderRadius: 6, fontSize: 12, padding: '6px 10px' },
  labelStyle: { color: 'var(--color-textMuted)' },
  itemStyle: { color: 'var(--color-textMain)', padding: 0 },
  cursor: { fill: 'var(--fg-4)' },
};


/**
 * Régua de um pagamento: o trilho tem o tamanho do que entra; a parte preenchida é o que já está
 * comprometido com dívidas; o que passa do salário sai depois do fim do trilho, em vermelho.
 * `scale` é o maior valor entre todas as réguas, para elas serem comparáveis entre si.
 */
function PayRuler({ label, detail, pay, owed, scale }: { label: string; detail: string; pay: number; owed: number; scale: number }) {
  const left = pay - owed;
  const pct = (v: number) => `${scale > 0 ? (v / scale) * 100 : 0}%`;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <p className="text-sm text-white">{label}</p>
        <p className={`text-sm font-medium whitespace-nowrap ${balanceTone(left)}`}>
          {left < 0 ? `faltam ${fmt(left)}` : `sobram ${fmt(left)}`}
        </p>
      </div>
      <div className="relative h-2" role="img"
        aria-label={`${label}: recebe ${fmt(pay)}, dívidas ${fmt(owed)}, ${left < 0 ? 'faltam' : 'sobram'} ${fmt(left)}`}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(pay), backgroundColor: 'var(--ruler-free)' }} />
        <div className="absolute inset-y-0 left-0 rounded-l-full" style={{ width: pct(Math.min(owed, pay)), backgroundColor: 'var(--color-debt)' }} />
        {owed > pay && (
          <div className="absolute inset-y-0 rounded-r-full" style={{ left: pct(pay), width: pct(owed - pay), backgroundColor: 'var(--color-red-500)' }} />
        )}
      </div>
      <p className="text-xs text-textMuted mt-1.5">{detail}</p>
    </div>
  );
}

/** Divisão de um total por forma de pagamento — linhas pequenas, valores alinhados à direita. */
function PaymentTypeBreakdown({ values, tone = 'text-white' }: { values: ByPaymentType; tone?: string }) {
  return (
    <dl className="mt-2 space-y-0.5 text-[13px]">
      {([
        ['Débito e PIX', values.debitPix],
        ['Crédito à vista', values.credit],
        ['Crédito parcelado', values.installment],
      ] as const).map(([label, value]) => (
        <div key={label} className="flex justify-between gap-2 whitespace-nowrap">
          <dt className="text-textMuted">{label}</dt>
          <dd className={value === 0 ? 'text-textMuted' : tone}>{fmt(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Receita extra no formulário: o valor fica como texto enquanto é digitado. */
type ExtraDraft = Omit<ExtraIncome, 'amount'> & { amount: string };

/** Popup para adicionar ou editar uma receita extra. Confirmar só devolve o rascunho: quem salva é o formulário do salário. */
function ExtraIncomeDialog({ initial, isNew, payDay, biweekly, onConfirm, onClose }: {
  initial: ExtraDraft; isNew: boolean; payDay: number; biweekly: boolean; onConfirm: (draft: ExtraDraft) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const set = (patch: Partial<ExtraDraft>) => setDraft(d => ({ ...d, ...patch }));

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm({ ...draft, name: draft.name.trim() });
  };

  // Portal: o popup fica fora do <form> do salário (form dentro de form não vale) e de qualquer card com transform.
  return createPortal(
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form role="dialog" aria-modal="true" aria-labelledby="extra-income-title" onSubmit={submit}
        className="w-full max-w-sm panel rounded-2xl p-6" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-5">
          <h3 id="extra-income-title" className="text-base font-medium text-white">{isNew ? 'Nova receita extra' : 'Editar receita extra'}</h3>
          <button type="button" onClick={onClose} aria-label="Fechar" className="p-2 hover:bg-white/10 rounded-lg text-textMuted hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4">
          <FormField label="Nome" htmlFor="extra-income-name">
            <input id="extra-income-name" required autoFocus maxLength={60} placeholder="Ex.: PLR, 13º 1ª parcela"
              value={draft.name} onChange={e => set({ name: e.target.value })} className="input-field" />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Valor (R$)" htmlFor="extra-income-amount">
              <input id="extra-income-amount" type="number" min="0.01" step="0.01" inputMode="decimal" required placeholder="0,00"
                value={draft.amount} onChange={e => set({ amount: e.target.value })} className="input-field" />
            </FormField>
            <FormField label="Mês" htmlFor="extra-income-month">
              <input id="extra-income-month" type="month" required
                value={draft.month} onChange={e => set({ month: e.target.value })} className="input-field" />
            </FormField>
          </div>
          {biweekly && (
            <FormField label="Entra com o pagamento" htmlFor="extra-income-half">
              <select id="extra-income-half" value={draft.half} onChange={e => set({ half: e.target.value === '2' ? 2 : 1 })} className="input-field">
                <option value={1}>Do dia {payDay}</option>
                <option value={2}>Do dia {payDay + 15}</option>
              </select>
            </FormField>
          )}
          <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
            <input type="checkbox" checked={draft.yearly} onChange={e => set({ yearly: e.target.checked })} />
            Repete todo ano
          </label>
        </div>
        <div className="flex gap-3 mt-6">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm text-textMuted border border-[var(--line)] hover:bg-white/5 transition-colors">Cancelar</button>
          <button type="submit" className="flex-1 py-2.5 rounded-xl text-sm text-on-accent font-medium bg-primary hover:opacity-90 transition-opacity">
            {isNew ? 'Adicionar' : 'Salvar'}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

/** `month` (YYYY-MM) é o mês corrente; `extras` são as receitas extras que caem nele. */
function SalaryCell({ salary, monthly, month, extras, onSave }: { salary: Salary; monthly: number; month: string; extras: ExtraIncome[]; onSave: (s: Salary) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [secondAmount, setSecondAmount] = useState('');
  const [frequency, setFrequency] = useState<SalaryFrequency>('monthly');
  const [payDay, setPayDay] = useState(15);
  const [extraDrafts, setExtraDrafts] = useState<ExtraDraft[]>([]);
  // Popup aberto: `index` null = nova receita extra; senão, a posição da que está sendo editada.
  const [extraDialog, setExtraDialog] = useState<{ index: number | null; draft: ExtraDraft } | null>(null);
  const [saving, setSaving] = useState(false);
  const closeExtraDialog = useCallback(() => setExtraDialog(null), []);
  const confirmExtra = (draft: ExtraDraft) => {
    const index = extraDialog?.index ?? null;
    setExtraDrafts(list => index === null ? [...list, draft] : list.map((e, j) => j === index ? draft : e));
    setExtraDialog(null);
  };

  const startEdit = () => {
    setAmount(salary.amount ? String(salary.amount) : '');
    setSecondAmount(salary.secondAmount ? String(salary.secondAmount) : '');
    setFrequency(salary.frequency);
    setPayDay(salary.payDay);
    setExtraDrafts(salary.extras.map(e => ({ ...e, amount: String(e.amount) })));
    setEditing(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Mensal não tem 2º pagamento: guarda o mesmo valor, que já vem preenchido se virar quinzenal.
      const first = Number(amount) || 0;
      const second = frequency === 'biweekly' ? Number(secondAmount) || 0 : first;
      const nextExtras = extraDrafts.map(e => ({ ...e, name: e.name.trim(), amount: Number(e.amount) || 0 }));
      await onSave({ amount: first, secondAmount: second, frequency, payDay, extras: nextExtras });
      setEditing(false);
    } catch {
      // onSave já avisou o usuário; o formulário continua aberto para corrigir.
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor="salary-amount" className="text-sm text-textMuted">
          {frequency === 'biweekly' ? `Salário dia ${payDay}` : 'Salário mensal'}
        </label>
        <input id="salary-amount" type="number" min="0" step="0.01" inputMode="decimal" required autoFocus
          value={amount} onChange={e => setAmount(e.target.value)} className="input-field" />
        {frequency === 'biweekly' && (
          <>
            <label htmlFor="salary-second-amount" className="text-sm text-textMuted">Salário dia {payDay + 15}</label>
            <input id="salary-second-amount" type="number" min="0" step="0.01" inputMode="decimal" required
              value={secondAmount} onChange={e => setSecondAmount(e.target.value)} className="input-field" />
          </>
        )}
        <label htmlFor="salary-frequency" className="sr-only">Periodicidade</label>
        <select id="salary-frequency" value={frequency} onChange={e => setFrequency(e.target.value as SalaryFrequency)} className="input-field">
          <option value="monthly">Mensal</option>
          <option value="biweekly">Quinzenal</option>
        </select>
        {frequency === 'biweekly' && (
          <>
            <label htmlFor="salary-pay-day" className="text-sm text-textMuted">Dias de pagamento</label>
            <select id="salary-pay-day" value={payDay} onChange={e => setPayDay(Number(e.target.value))} className="input-field">
              {Array.from({ length: 15 }, (_, i) => i + 1).map(d => (
                <option key={d} value={d}>Dias {d} e {d + 15}</option>
              ))}
            </select>
          </>
        )}
        <p className="text-sm text-textMuted mt-1">Receitas extras (PLR, 13º, férias...)</p>
        {extraDrafts.length > 0 && (
          <ul className="flex flex-col gap-1">
            {extraDrafts.map((extra, i) => (
              <li key={i} className="flex items-center gap-1 text-sm">
                <button type="button" onClick={() => setExtraDialog({ index: i, draft: extra })} aria-label={`Editar ${extra.name}`}
                  className="flex-1 min-w-0 flex justify-between gap-2 px-2 py-1.5 rounded-md text-left hover:bg-white/[0.06] transition-colors">
                  <span className="truncate text-white">{extra.name}</span>
                  <span className="shrink-0 text-textMuted">
                    {fmt(Number(extra.amount) || 0)} · {formatMonthLabel(extra.month)}{extra.yearly ? ' · todo ano' : ''}
                  </span>
                </button>
                <button type="button" onClick={() => setExtraDrafts(list => list.filter((_, j) => j !== i))} aria-label={`Remover ${extra.name}`}
                  className="p-1.5 rounded-md text-textMuted hover:text-red-400 hover:bg-red-500/10 transition-colors">
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={() => setExtraDialog({ index: null, draft: { name: '', amount: '', month, half: 1, yearly: false } })}
          className="self-start text-xs font-semibold text-accent hover:underline flex items-center gap-1">
          <Plus size={12} /> Adicionar receita extra
        </button>
        <div className="flex gap-2 mt-1">
          <button type="submit" disabled={saving} className="h-9 px-4 rounded-md bg-primary text-on-accent text-sm font-medium disabled:opacity-60">Salvar</button>
          <button type="button" onClick={() => setEditing(false)} className="h-9 px-4 rounded-md text-sm text-white bg-white/[0.06] hover:bg-white/10">Cancelar</button>
        </div>
      </form>
      {extraDialog && (
        <ExtraIncomeDialog initial={extraDialog.draft} isNew={extraDialog.index === null} payDay={payDay} biweekly={frequency === 'biweekly'}
          onConfirm={confirmExtra} onClose={closeExtraDialog} />
      )}
      </>
    );
  }

  // Sem salário, um botão para inseri-lo; depois, o lápis para editar.
  if (salaryPerMonth(salary) === 0) {
    return (
      <div>
        <p className="text-sm text-textMuted">Salário do mês</p>
        <button type="button" onClick={startEdit}
          className="h-9 px-4 mt-2 rounded-md bg-primary text-on-accent text-sm font-medium hover:opacity-90 transition-opacity">
          Inserir salário
        </button>
        <p className="text-xs text-textMuted mt-2">Informe o salário para calcular a sobra</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-textMuted">Salário do mês</p>
        <button type="button" onClick={startEdit} aria-label="Editar salário"
          className="p-1 -m-1 rounded-md text-textMuted hover:text-white hover:bg-white/[0.06] transition-colors">
          <Pencil size={13}/>
        </button>
      </div>
      <p className={`text-[22px] leading-8 font-bold ${monthly === 0 ? 'text-textMuted' : 'text-teal-400'}`}>{fmt(monthly)}</p>
      <p className="text-xs text-textMuted mt-1">
        {salary.frequency === 'biweekly'
            ? `Quinzenal, dias ${salary.payDay} e ${salary.payDay + 15} · ${salary.amount === salary.secondAmount
              ? `2 × ${fmt(salary.amount)}` : `${fmt(salary.amount)} + ${fmt(salary.secondAmount)}`}`
            : 'Mensal'}
      </p>
      {extras.map((extra, i) => (
        <p key={i} className="text-xs text-teal-400 mt-0.5">
          + {extra.name} {fmt(extra.amount)}{salary.frequency === 'biweekly' ? ` no dia ${extra.half === 1 ? salary.payDay : salary.payDay + 15}` : ''}
        </p>
      ))}
    </div>
  );
}

interface DashboardPageProps {
  accounts: Account[];
  dashboardAccountId: string | null;
  onChangeDashboardAccount: (id: string | null) => void;
  stats: FinancialStats;
  overBudget: BudgetProgress[];
  budgetProgress: BudgetProgress[];
  /** Mês do Dashboard (YYYY-MM): sobra, dívidas, gastos, categorias e orçamento são deste mês. */
  month: string;
  /** Meses do seletor, do mais recente para o mais antigo. */
  months: string[];
  onChangeMonth: (month: string) => void;
  usedCurrencies: string[];
  rates: ExchangeRates | null;
  ratesFailed: boolean;
  conversionIssue: boolean;
  missingCurrencies: string[];
  hasInvestments: boolean;
  investmentHoldings: InvestmentHoldings;
  isEmpty: boolean;
  hasAccounts: boolean;
  chartPeriod: 'daily' | 'all';
  onChangeChartPeriod: (period: 'daily' | 'all') => void;
  projection: ProjectionPoint[];
  onNavigate: (tab: Tab) => void;
  onFilterTransactions: (filter: 'all' | 'income' | 'expense') => void;
  onShowImport: () => void;
  salary: Salary;
  onSaveSalary: (salary: Salary) => Promise<void>;
  /** Botão de conectar banco (Open Finance), o mesmo da lateral — aparece na tela inicial sem contas. */
  connectBank?: ReactNode;
}

/**
 * Visão geral. A pergunta da tela: quanto sobra deste mês depois do cartão e das parcelas? A
 * resposta é o maior número e vem primeiro, com a régua de cada pagamento ao lado; saldos, fluxo,
 * categorias, projeção e orçamento respondem às perguntas seguintes, nessa ordem.
 */
export function DashboardPage({
  accounts, dashboardAccountId, onChangeDashboardAccount, stats, overBudget, budgetProgress, month, months, onChangeMonth,
  usedCurrencies, rates, ratesFailed, conversionIssue, missingCurrencies, hasInvestments,
  investmentHoldings, isEmpty, hasAccounts, chartPeriod, onChangeChartPeriod,
  projection, onNavigate, onFilterTransactions, onShowImport, salary, onSaveSalary, connectBank,
}: DashboardPageProps) {
  const chartAnimation = useChartAnimation();
  // Donut de categorias: passar o mouse destaca a fatia; clicar fixa o destaque (clicar de novo solta).
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);
  const [pickedCategory, setPickedCategory] = useState<string | null>(null);
  const togglePicked = (name: string) => setPickedCategory(togglingTo(name));
  const monthName = formatMonthLabel(month).split('/')[0].toLowerCase();
  const monthExtras = useMemo(() => extrasInMonth(salary, month), [salary, month]);
  const monthlySalary = salaryPerMonth(salary) + sumExtras(monthExtras);
  // Tudo o que se deve no mês é dívida: compras no cartão (à vista e parcelas) + parcelas cadastradas.
  const monthDebts = stats.monthCardExpense + stats.monthDebtPayments + stats.monthRecurring;
  // Entradas do mês: salário + recorrências de receita (Devedores).
  const debtorsIncome = stats.monthRecurringIncome;
  const monthlyIncome = monthlySalary + debtorsIncome;
  // Sobra = entradas − dívidas do mês. As despesas do mês são só informativas (o total gasto).
  const leftover = monthlyIncome - monthDebts;
  const monthDays = daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)));

  // Uma régua por pagamento: no quinzenal, cada metade com as dívidas que vencem até o pagamento seguinte.
  // O texto de cada uma (`detail`) é montado na hora de desenhar, para seguir o "esconder valores".
  const rulers = useMemo(() => {
    if (salary.frequency !== 'biweekly') {
      return [{ label: `Salário de ${monthName}`, owedLabel: 'dívidas do mês', pay: monthlyIncome, owed: monthDebts }];
    }
    const halves = biweeklyLeftovers(salary, stats.monthOutflows, monthDays, monthExtras, stats.monthInflows);
    return halves.map((h, i) => {
      const until = i === 0 ? `até o dia ${halves[1].day - 1}` : 'até o fim do mês';
      return { label: `Pagamento do dia ${h.day}`, owedLabel: `dívidas ${until}:`, pay: h.pay, owed: h.pay - h.leftover };
    });
  }, [salary, stats.monthOutflows, stats.monthInflows, monthDays, monthExtras, monthName, monthDebts, monthlyIncome]);
  const rulerScale = Math.max(...rulers.map(r => Math.max(r.pay, r.owed)));

  // Fluxo diário: cada dia do mês, com zero nos dias sem lançamento (o eixo é tempo).
  const dailyFlow = useMemo(() => {
    const byKey = new Map(stats.dailyEvolution.map(d => [d.name, d.balance]));
    return Array.from({ length: monthDays }, (_, i) => {
      const iso = dateInMonth(month, i + 1);
      return { name: `${iso.slice(8, 10)}/${iso.slice(5, 7)}`, balance: byKey.get(`${iso.slice(5, 7)}/${iso.slice(8, 10)}`) ?? 0 };
    });
  }, [stats.dailyEvolution, month, monthDays]);
  const flowData = chartPeriod === 'daily' ? dailyFlow : stats.balanceByMonth;
  const flowTicks = niceTicks(flowData.map(d => d.balance));
  const projectionTicks = niceTicks(projection.map(p => p.balance));

  const categories = stats.expenseByCategoryByMonth[month] ?? [];
  const categoryTotal = categories.reduce((s, c) => s + c.amount, 0);
  const categoryShare = (amount: number) =>
    categoryTotal > 0 ? `${((amount / categoryTotal) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%` : '—';
  const activeIndex = categories.findIndex(c => c.name === (hoveredCategory ?? pickedCategory));
  const activeCategory = categories[activeIndex];
  const hasProjection = projection.some(p => p.salaryDelta > 0 || p.debtDelta > 0);
  const finding = monthlyIncome === 0
    ? 'Informe o salário para ver quanto sobra depois das dívidas do mês.'
    : leftover < 0
      ? `As dívidas de ${monthName} passam as entradas em ${fmt(leftover)}.`
      : `Sobram ${fmt(leftover)} de ${monthName} depois do cartão, das parcelas e das recorrências.`;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 mb-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <h1 className="text-2xl font-medium tracking-tight text-white">Visão geral</h1>
            <MonthNavigator id="dashboard-month" value={month} months={months}
              onChange={m => { onChangeMonth(m); setPickedCategory(null); }}/>
          </div>
          <p className="text-sm text-textMuted mt-2">{finding}</p>
        </div>
        <div className="flex items-center gap-2">
          {accounts.length > 0 && (
            <>
              <label htmlFor="dashboard-account" className="sr-only">Banco</label>
              <select id="dashboard-account" value={dashboardAccountId || ''}
                onChange={(e) => onChangeDashboardAccount(e.target.value || null)} className="input-field !w-auto">
                <AccountOptions accounts={accounts} />
              </select>
            </>
          )}
          <button type="button" onClick={onShowImport}
            className="h-9 px-4 rounded-md bg-primary text-on-accent text-sm font-medium flex items-center gap-2 whitespace-nowrap hover:opacity-90 transition-opacity">
            <Upload size={14}/> Importar extrato
          </button>
        </div>
      </div>

      {/* Avisos: um por linha, discretos, com o fato e o atalho para resolver. */}
      {(stats.overdueDebts.length > 0 || overBudget.length > 0 || (usedCurrencies.length > 0 && (rates !== null || ratesFailed))) && (
        <div className="space-y-2 mb-3">
          {stats.overdueDebts.length > 0 && (
            <button type="button" onClick={() => onNavigate('debts')}
              className="w-full text-left text-sm px-3 py-2 rounded-md border bg-card hover:bg-white/[0.02] transition-colors"
              style={{ borderColor: 'color-mix(in srgb, var(--color-red-500) 35%, transparent)' }}>
              <span className="text-red-400 font-medium">
                {stats.overdueDebts.length === 1 ? '1 dívida vencida' : `${stats.overdueDebts.length} dívidas vencidas`}
              </span>
              <span className="text-white">: {stats.overdueDebts.map(d => d.name).join(', ')}</span>
            </button>
          )}
          {/* FIN-047 */}
          {overBudget.length > 0 && (
            <button type="button" onClick={() => onNavigate('budgets')}
              className="w-full text-left text-sm px-3 py-2 rounded-md border bg-card hover:bg-white/[0.02] transition-colors"
              style={{ borderColor: 'color-mix(in srgb, var(--color-red-500) 35%, transparent)' }}>
              <span className="text-red-400 font-medium">
                {overBudget.length === 1 ? '1 orçamento estourado' : `${overBudget.length} orçamentos estourados`}
              </span>
              <span className="text-white">: {overBudget.map(b => b.category).join(', ')}</span>
            </button>
          )}
          {/* FIN-076: com moeda estrangeira em uso, os totais são convertidos para real. */}
          {usedCurrencies.length > 0 && (rates !== null || ratesFailed) && (
            <p role="status" className={`text-xs ${conversionIssue ? 'text-amber-400' : 'text-textMuted'}`}>
              {describeConversion(usedCurrencies, missingCurrencies, rates)}
            </p>
          )}
        </div>
      )}

      {isEmpty && !hasAccounts ? (
        <section className="panel rounded-2xl p-6">
          <h2 className="text-base font-medium text-white">Comece pelas suas contas</h2>
          <p className="text-sm text-textMuted mt-1 mb-5 max-w-xl">
            Conecte o banco pelo Open Finance ou importe o extrato (CSV ou OFX).
            A sobra do mês aparece aqui assim que houver salário e dívidas.
          </p>
          {/* O mesmo painel "Conectar banco" da lateral. */}
          {connectBank && <div className="max-w-xs mb-3">{connectBank}</div>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onShowImport}
              className="h-9 px-4 rounded-md text-sm text-white bg-white/[0.06] hover:bg-white/10">Importar extrato</button>
          </div>
        </section>
      ) : (
        <div className="space-y-3">
          {/* ── O mês: a sobra, a régua de cada pagamento, e de onde vêm os números. ── */}
          <section aria-labelledby="month-title" className="panel rounded-2xl">
            <div className="p-5 md:p-6 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
              <div>
                <h2 id="month-title" className="text-sm text-textMuted">Sobra de {monthName}</h2>
                <p className={`text-[32px] leading-10 font-bold tracking-tight mt-1 ${monthlyIncome === 0 ? 'text-textMuted' : balanceTone(leftover)}`}>
                  {signed(leftover)}
                </p>
                <p className="text-sm text-textMuted mt-1">
                  Salário {fmt(monthlySalary)}{debtorsIncome > 0 && <> + devedores {fmt(debtorsIncome)}</>} − dívidas do mês {fmt(monthDebts)}
                </p>
              </div>
              <div className="space-y-4 lg:pt-1">
                {rulers.map(({ owedLabel, ...r }) => (
                  <PayRuler key={r.label} {...r} detail={`Recebe ${fmt(r.pay)} · ${owedLabel} ${fmt(r.owed)}`} scale={rulerScale} />
                ))}
                <p className="text-xs text-textMuted flex items-center gap-x-4 gap-y-1 flex-wrap">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: 'var(--color-debt)' }}/>Comprometido com dívidas</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: 'var(--ruler-free)' }}/>Livre</span>
                  {rulers.some(r => r.owed > r.pay) && (
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: 'var(--color-red-500)' }}/>Além do salário</span>
                  )}
                </p>
              </div>
            </div>
            <div className="grid lg:grid-cols-3 border-t border-white/[0.07] divide-y lg:divide-y-0 lg:divide-x divide-white/[0.07]">
              <div className="p-5 md:px-6">
                <SalaryCell salary={salary} monthly={monthlySalary} month={month} extras={monthExtras} onSave={onSaveSalary} />
              </div>
              <button type="button" onClick={() => onNavigate('debts')} className="p-5 md:px-6 text-left hover:bg-white/[0.02] transition-colors">
                <p className="text-sm text-textMuted">Dívidas do mês</p>
                <p className="text-[22px] leading-8 font-bold text-debt">{fmt(monthDebts)}</p>
                <PaymentTypeBreakdown values={stats.monthDebtsByType} tone="text-debt" />
                {stats.monthRecurring > 0 && <p className="text-xs text-textMuted mt-1">Inclui recorrências: {fmt(stats.monthRecurring)}</p>}
              </button>
              <button type="button" onClick={() => { onFilterTransactions('expense'); onNavigate('transactions'); }}
                className="p-5 md:px-6 text-left hover:bg-white/[0.02] transition-colors">
                <p className="text-sm text-textMuted">Gasto em {monthName}</p>
                <p className="text-[22px] leading-8 font-bold text-white">{fmt(stats.monthExpense)}</p>
                <PaymentTypeBreakdown values={stats.monthExpenseByType} />
              </button>
            </div>
          </section>

          {/* ── Saldos que não mudam durante o dia (FIN-018/FIN-073). ── */}
          <section aria-label="Saldos" className={`panel rounded-2xl grid divide-y sm:divide-y-0 sm:divide-x divide-white/[0.07] ${hasInvestments ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
            <div className="px-5 md:px-6 py-4">
              <p className="text-sm text-textMuted">Saldo em contas</p>
              <p className={`text-[22px] leading-8 font-bold ${balanceTone(stats.realBalance)}`}>{signed(stats.realBalance)}</p>
              <p className="text-xs text-textMuted">Contas correntes, sem investimentos</p>
            </div>
            {hasInvestments && (
              <button type="button" onClick={() => onNavigate('investments')} className="px-5 md:px-6 py-4 text-left hover:bg-white/[0.02] transition-colors">
                <p className="text-sm text-textMuted">Investimentos</p>
                <p className="text-[22px] leading-8 font-bold text-white">{signed(stats.investmentBalance)}</p>
                <p className="text-xs text-textMuted">{describeHoldings(investmentHoldings)}</p>
              </button>
            )}
            <button type="button" onClick={() => onNavigate('debts')} className="px-5 md:px-6 py-4 text-left hover:bg-white/[0.02] transition-colors">
              <p className="text-sm text-textMuted">Total em dívidas</p>
              <p className={`text-[22px] leading-8 font-bold ${stats.totalOwed === 0 ? 'text-textMuted' : 'text-debt'}`}>{fmt(stats.totalOwed)}</p>
              <p className="text-xs text-textMuted">Cartão, parcelas futuras, dívidas cadastradas e recorrências do mês</p>
              {stats.monthRecurringAhead > 0 && <p className="text-xs text-textMuted">Inclui recorrências a lançar: {fmt(stats.monthRecurringAhead)}</p>}
            </button>
          </section>

          {/* ── Fluxo e categorias ── */}
          <div className="grid gap-3 lg:grid-cols-3">
            <section aria-labelledby="flow-title" className="panel rounded-2xl p-5 md:p-6 lg:col-span-2">
              <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
                <h2 id="flow-title" className="text-base font-medium text-white">
                  {chartPeriod === 'daily' ? `Entradas menos saídas, por dia de ${monthName}` : 'Entradas menos saídas, por mês'}
                </h2>
                <div role="group" aria-label="Período" className="flex p-0.5 rounded-md bg-white/[0.06]">
                  {([['daily', 'Dias do mês'], ['all', 'Por mês']] as const).map(([value, label]) => (
                    <button key={value} type="button" aria-pressed={chartPeriod === value} onClick={() => onChangeChartPeriod(value)}
                      className={`h-7 px-3 text-xs rounded transition-colors ${chartPeriod === value ? 'bg-card text-white font-medium' : 'text-textMuted hover:text-white'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-[272px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={flowData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false}/>
                    <XAxis dataKey="name" axisLine={false} tickLine={false} interval={chartPeriod === 'daily' ? 5 : 0} tickMargin={6}/>
                    <YAxis axisLine={false} tickLine={false} tickFormatter={axisMoney} width={60} ticks={flowTicks} domain={[flowTicks[0], flowTicks[flowTicks.length - 1]]} interval={0}/>
                    <ReferenceLine y={0} stroke="var(--chart-axis)" strokeOpacity={0.6}/>
                    <RechartsTooltip {...tooltipStyle} formatter={(v) => [signed(Number(v)), 'Entradas − saídas']}/>
                    <Bar dataKey="balance" maxBarSize={chartPeriod === 'daily' ? 14 : 36} {...chartAnimation}>
                      {flowData.map(d => <Cell key={d.name} fill={d.balance < 0 ? 'var(--color-red-500)' : 'var(--color-teal-500)'}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-textMuted mt-2">Em verde, entrou mais do que saiu; em vermelho, saiu mais do que entrou. Transferências entre suas contas não contam.</p>
            </section>

            <section aria-labelledby="category-title" className="panel rounded-2xl p-5 md:p-6">
              <h2 id="category-title" className="text-base font-medium text-white mb-4">Gastos por categoria em {monthName}</h2>
              {categories.length === 0 ? (
                <p className="text-sm text-textMuted py-3 px-3 rounded-md border border-dashed border-[var(--control)]">
                  Nenhum gasto neste mês.
                </p>
              ) : (
                <div className="flex flex-col sm:flex-row lg:flex-col gap-5 items-center sm:items-start lg:items-center">
                  <div className="relative w-32 h-32 shrink-0">
                    <style>{activeIndex < 0 ? '' :
                      `.cat-slice:not(.cat-slice-${activeIndex}){opacity:.35}.cat-slice-${activeIndex}{transform:scale(1.08)}`}</style>
                    <CategoryDonut data={categories} animation={chartAnimation}
                      onHover={setHoveredCategory} onPick={setPickedCategory}/>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
                      <span className="text-xs text-textMuted truncate max-w-[84px]">{activeCategory ? activeCategory.name : 'Total'}</span>
                      <span className="text-sm font-bold text-white">{fmt(activeCategory ? activeCategory.amount : categoryTotal)}</span>
                      {activeCategory && <span className="text-xs text-textMuted">{categoryShare(activeCategory.amount)}</span>}
                    </div>
                  </div>
                  <table className="w-full text-[13px]">
                    <caption className="sr-only">Gastos por categoria</caption>
                    <tbody>
                      {categories.map(c => (
                        <tr key={c.name} onMouseEnter={() => setHoveredCategory(c.name)} onMouseLeave={() => setHoveredCategory(null)}
                          className={`transition-opacity ${activeCategory && c.name !== activeCategory.name ? 'opacity-40' : ''}`}>
                          <td className="py-1 pr-2 w-3">
                            <span className="block w-2 h-2 rounded-full" style={categoryDot(c.name)}/>
                          </td>
                          <td className="py-1 pr-2 text-white truncate max-w-0 w-full">
                            <button type="button" aria-pressed={pickedCategory === c.name} onClick={() => togglePicked(c.name)}
                              onFocus={() => setHoveredCategory(c.name)} onBlur={() => setHoveredCategory(null)}
                              className="w-full text-left truncate rounded-sm">
                              {c.name}
                            </button>
                          </td>
                          <td className="py-1 pr-2 text-right text-white whitespace-nowrap">{fmt(c.amount)}</td>
                          <td className="py-1 text-right text-textMuted whitespace-nowrap">{categoryShare(c.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          {/* ── Para onde o saldo vai (FIN-059) e o orçamento do mês (FIN-046). ── */}
          {(hasProjection || budgetProgress.length > 0) && (
            <div className={`grid gap-3 items-start ${hasProjection && budgetProgress.length > 0 ? 'lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]' : ''}`}>
              {hasProjection && (
                <section aria-labelledby="projection-title" className="panel rounded-2xl p-5 md:p-6">
                  <div className="flex justify-between items-baseline gap-3 mb-4">
                    <h2 id="projection-title" className="text-base font-medium text-white">Saldo projetado</h2>
                    <span className="text-xs text-textMuted">{projection[0].name} a {projection[projection.length - 1].name}</span>
                  </div>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={projection} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid vertical={false}/>
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tickMargin={6}/>
                        <YAxis axisLine={false} tickLine={false} tickFormatter={axisMoney} width={60} ticks={projectionTicks} domain={[projectionTicks[0], projectionTicks[projectionTicks.length - 1]]} interval={0}/>
                        <ReferenceLine y={0} stroke="var(--chart-axis)" strokeOpacity={0.6}/>
                        <RechartsTooltip {...tooltipStyle} formatter={(v) => [signed(Number(v)), 'Saldo ao fim do mês']}/>
                        <Bar dataKey="balance" maxBarSize={36} {...chartAnimation}>
                          {projection.map(p => <Cell key={p.month} fill={p.balance < 0 ? 'var(--color-red-500)' : 'var(--color-teal-500)'}/>)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-xs text-textMuted mt-2">
                    Saldo de hoje, mais o salário e as receitas extras de cada mês, menos a fatura, as parcelas do cartão e as dívidas.
                  </p>
                </section>
              )}

              {budgetProgress.length > 0 && (
                <section aria-labelledby="budget-title" className="panel rounded-2xl p-5 md:p-6">
                  <div className="flex justify-between items-baseline gap-3 mb-4">
                    <h2 id="budget-title" className="text-base font-medium text-white">Orçamento de {monthName}</h2>
                    <button type="button" onClick={() => onNavigate('budgets')} className="text-xs text-textMuted hover:text-white transition-colors">
                      Ver todos ({budgetProgress.length})
                    </button>
                  </div>
                  <ul className="space-y-3.5">
                    {[...budgetProgress].sort((a, b) => b.percentage - a.percentage).slice(0, 5).map(b => (
                      <li key={b.id}>
                        <div className="flex justify-between gap-3 text-sm mb-1.5">
                          <span className="text-white truncate flex items-center gap-2"><span className="inline-block w-2 h-2 rounded-full shrink-0" style={categoryDot(b.category)} aria-hidden="true"/>{b.category}</span>
                          <span className="whitespace-nowrap">
                            <span className={b.isOverLimit ? 'text-red-400 font-medium' : 'text-white'}>{fmt(b.spent)}</span>
                            <span className="text-textMuted"> de {fmt(b.limit)}</span>
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                          <div className="h-full rounded-full"
                            style={{ width: `${Math.min(100, b.percentage)}%`, backgroundColor: b.isOverLimit ? 'var(--color-red-500)' : categoryColor(b.category) }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
