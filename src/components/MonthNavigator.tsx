import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatMonthLabel } from '../utils/dates';
import { formatBRL } from '../utils/money';
import { ALL_MONTHS } from '../utils/transactions';

interface MonthNavigatorProps {
  /** `id` do `<select>`, associado ao `<label>` — precisa ser único na página. */
  id: string;
  /** Mês selecionado (YYYY-MM), ou `ALL_MONTHS` quando `allowAll` está ligado. */
  value: string;
  /** Meses disponíveis (YYYY-MM), do mais recente para o mais antigo. */
  months: string[];
  onChange: (month: string) => void;
  /** Oferece a opção "Todos os meses", que desliga o recorte mensal. */
  allowAll?: boolean;
}

const ARROW_CLASS =
  'p-2.5 rounded-xl border border-white/10 text-textMuted hover:text-white hover:bg-white/5 ' +
  'transition-colors disabled:opacity-30 disabled:cursor-not-allowed';

/**
 * Seletor de mês de referência com setas de navegação — compartilhado pelas abas
 * Transações (FIN-093) e Dívidas (FIN-094), para que as duas se comportem igual.
 *
 * `months` vem do mais recente para o mais antigo, então o índice seguinte é o mês
 * anterior. Em "Todos os meses" (fora da lista) as setas ficam desabilitadas, porque não há
 * um mês de partida.
 */
export function MonthNavigator({ id, value, months, onChange, allowAll = false }: MonthNavigatorProps) {
  const index = months.indexOf(value);
  const previous = index === -1 ? undefined : months[index + 1];
  const next = index > 0 ? months[index - 1] : undefined;

  return (
    <div className="flex items-end gap-2">
      <button type="button" onClick={() => previous && onChange(previous)} disabled={!previous}
        aria-label="Mês anterior" title="Mês anterior" className={ARROW_CLASS}>
        <ChevronLeft size={16} aria-hidden="true"/>
      </button>
      <div className="min-w-[170px]">
        <label htmlFor={id} className="block text-[10px] uppercase tracking-wider text-textMuted mb-1">Mês de referência</label>
        <select id={id} value={value} onChange={e => onChange(e.target.value)} className="input-field font-semibold">
          {allowAll && <option value={ALL_MONTHS}>Todos os meses</option>}
          {months.map(m => <option key={m} value={m}>{formatMonthLabel(m)}</option>)}
        </select>
      </div>
      <button type="button" onClick={() => next && onChange(next)} disabled={!next}
        aria-label="Mês seguinte" title="Mês seguinte" className={ARROW_CLASS}>
        <ChevronRight size={16} aria-hidden="true"/>
      </button>
    </div>
  );
}

/**
 * Um dos valores exibidos ao lado do mês de referência.
 *
 * Os valores aparecem em módulo — a direção está no rótulo ("Receitas", "Despesas"). `signed`
 * é para um saldo, que pode ser negativo e precisa do sinal explícito.
 */
export function MonthTotal({ label, value, color, signed }: { label: string; value: number; color: string; signed?: boolean }) {
  return (
    <div className="text-right">
      <p className="text-[10px] uppercase tracking-wider text-textMuted mb-1">{label}</p>
      <p className="text-xl font-bold tracking-tight" style={{ color }}>
        {signed && value < 0 ? '−' : ''}{formatBRL(value)}
      </p>
    </div>
  );
}
