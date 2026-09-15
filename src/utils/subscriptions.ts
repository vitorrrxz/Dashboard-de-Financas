// FIN-111 — assinaturas (streaming, aplicativos, seguros) cobradas todo mês e que passam
// despercebidas no meio das transações: recorrências (FIN-053 a FIN-057) só existem se cadastradas
// à mão. `detectSubscriptions` é função pura — agrupa despesas pelo nome normalizado e reconhece
// grupo com 3+ ocorrências em intervalo regular e valor estável — para ser testável sem tela.
import type { Transaction, RecurringTransaction } from '../types';
import type { RecurrenceFrequency } from './dates';
import { advanceOccurrence, daysBetween } from './dates';
import { isOwnTransfer } from './categories';

export interface DetectedSubscription {
  /** Nome normalizado — chave estável do grupo: usada para saber se já virou recorrência e para descartar. */
  key: string;
  /** Nome como aparece na transação mais recente do grupo, para exibir e para pré-preencher a recorrência. */
  name: string;
  category: string;
  /** Sempre negativo (despesa) — mediana dos valores do grupo. */
  amount: number;
  frequency: RecurrenceFrequency;
  occurrences: number;
  /** Próxima ocorrência esperada a partir da mais recente, para pré-preencher a recorrência criada. */
  nextOccurrence: string;
}

const MIN_OCCURRENCES = 3;
// "Pequena": cobre um reajuste normal (ex.: assinatura sobe 10% na renovação) sem deixar duas
// despesas diferentes, que só coincidem no nome, entrarem juntas no mesmo grupo.
const AMOUNT_TOLERANCE = 0.15;

// Intervalo (em dias) entre ocorrências consecutivas compatível com cada frequência — com folga
// para o dia da cobrança escorregar por fim de semana/feriado (ver FIN-053 pelas mesmas frequências).
const INTERVAL_BOUNDS_DAYS: Record<RecurrenceFrequency, [min: number, max: number]> = {
  weekly: [5, 9],
  monthly: [24, 35],
  yearly: [355, 376],
};

/** Nome normalizado para agrupar: minúsculas, sem acento, espaços colapsados (mesma dobra usada em `autoCategory`). */
export function normalizeSubscriptionName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** A frequência cujo intervalo cobre TODOS os intervalos entre ocorrências consecutivas, ou `null`. */
function classifyFrequency(gaps: number[]): RecurrenceFrequency | null {
  for (const frequency of Object.keys(INTERVAL_BOUNDS_DAYS) as RecurrenceFrequency[]) {
    const [min, max] = INTERVAL_BOUNDS_DAYS[frequency];
    if (gaps.every(gap => gap >= min && gap <= max)) return frequency;
  }
  return null;
}

/** Mediana de uma lista de números (usada para o valor "típico" do grupo, resistente a outlier). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** `true` se todo valor (em módulo) fica a `AMOUNT_TOLERANCE` da mediana do grupo. */
function isAmountStable(amounts: number[]): boolean {
  const typical = median(amounts);
  if (typical <= 0) return false;
  return amounts.every(amount => Math.abs(amount - typical) <= typical * AMOUNT_TOLERANCE);
}

/**
 * Detecta assinaturas nas transações: despesas agrupadas pelo nome normalizado, com 3+ ocorrências
 * em intervalo regular e valor estável. Fica de fora o grupo que já corresponde a uma recorrência
 * cadastrada (`recurring`, ativa ou pausada — o usuário já sabe dela) ou que foi descartado
 * (`dismissedKeys`, ver `subscriptionStorage`).
 */
export function detectSubscriptions(
  transactions: Transaction[],
  recurring: RecurringTransaction[],
  dismissedKeys: ReadonlySet<string> = new Set(),
): DetectedSubscription[] {
  const knownKeys = new Set(recurring.map(r => normalizeSubscriptionName(r.name)));

  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.amount >= 0 || isOwnTransfer(t)) continue;
    const key = normalizeSubscriptionName(t.name);
    const group = groups.get(key);
    if (group) group.push(t); else groups.set(key, [t]);
  }

  const result: DetectedSubscription[] = [];
  for (const [key, group] of groups) {
    if (group.length < MIN_OCCURRENCES || knownKeys.has(key) || dismissedKeys.has(key)) continue;

    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
    const gaps = sorted.slice(1).map((t, i) => daysBetween(sorted[i].date, t.date));
    // Gap zero/negativo (mesmo dia, ou datas fora de ordem por empate) não mede um intervalo real.
    if (gaps.some(gap => gap <= 0)) continue;

    const frequency = classifyFrequency(gaps);
    if (!frequency) continue;

    const amounts = sorted.map(t => Math.abs(t.amount));
    if (!isAmountStable(amounts)) continue;

    const last = sorted[sorted.length - 1];
    result.push({
      key,
      name: last.name,
      category: last.category,
      amount: -median(amounts),
      frequency,
      occurrences: sorted.length,
      nextOccurrence: advanceOccurrence(last.date, frequency),
    });
  }
  return result.sort((a, b) => b.occurrences - a.occurrences);
}

const OCCURRENCES_PER_YEAR: Record<RecurrenceFrequency, number> = { weekly: 52, monthly: 12, yearly: 1 };

/** Custo mensal equivalente de uma assinatura — semanal e anual convertidos para comparar com o mensal. */
export function monthlySubscriptionCost(sub: Pick<DetectedSubscription, 'amount' | 'frequency'>): number {
  return (Math.abs(sub.amount) * OCCURRENCES_PER_YEAR[sub.frequency]) / 12;
}

// Descarte de sugestão: só neste navegador (o FinFlow é pessoal, sem sincronização entre
// dispositivos — ver FIN-077) — mesmo padrão de `utils/theme.ts` (chave própria, guardado contra
// armazenamento indisponível/bloqueado).
const DISMISSED_STORAGE_KEY = 'finflow_dismissed_subscriptions';

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Chaves (nome normalizado) das sugestões já descartadas pelo usuário. */
export function readDismissedSubscriptions(storage: Pick<Storage, 'getItem'> | null = browserStorage()): Set<string> {
  try {
    const raw = storage?.getItem(DISMISSED_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Marca `key` como descartada — a sugestão para de aparecer até a recorrência ser criada de outro jeito. */
export function dismissSubscription(key: string, storage: Storage | null = browserStorage()): void {
  try {
    const current = readDismissedSubscriptions(storage);
    current.add(key);
    storage?.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...current]));
  } catch {
    // Cota cheia ou armazenamento bloqueado: a sugestão volta a aparecer na próxima vez, sem quebrar a tela.
  }
}
