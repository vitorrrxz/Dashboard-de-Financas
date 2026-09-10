/**
 * Aritmética de datas em strings ISO (YYYY-MM-DD), sem passar por `new Date(string)`.
 *
 * Todo o app trata datas como strings ISO e as compara lexicograficamente (ver
 * `isDebtOverdue` em `debts.ts`) — `new Date('YYYY-MM-DD')` é interpretado como UTC 00:00
 * e, comparado com a hora local, pode divergir em um dia em fusos negativos como o do
 * Brasil (UTC-3). Estas funções fazem a aritmética sobre os componentes numéricos da
 * própria string, então são imunes a fuso horário.
 *
 * Extraído de `debts.ts` (onde `advanceMonth` nasceu, em FIN-005/FIN-034) ao implementar
 * as transações recorrentes (FIN-053), que precisam da mesma lógica de ano bissexto e de
 * "clamp" de dia — duplicá-la seria a terceira cópia da mesma regra.
 */

/** Ano bissexto pela regra gregoriana completa (divisível por 4, exceto séculos não divisíveis por 400). */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Quantidade de dias do mês (`month` de 1 a 12), já considerando fevereiro em ano bissexto. */
export function daysInMonth(year: number, month: number): number {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1];
}

/** Quebra uma data ISO em componentes numéricos; `null` se o formato não for YYYY-MM-DD. */
function parseISO(dateString: string): { year: number; month: number; day: number } | null {
  const parts = dateString.split('-');
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1) return null;
  return { year, month, day };
}

/** Formata componentes numéricos de volta para ISO (YYYY-MM-DD), com zero à esquerda. */
function formatISO(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Avança uma data ISO em exatamente um mês, ajustando o ano quando cruza dezembro→janeiro.
 * O dia é "clampado" para o último dia válido do mês de destino quando necessário
 * (ex.: 31/jan → 28 ou 29/fev, nunca "31/fev", que não é uma data válida) — sem isso, uma
 * dívida ou recorrência com vencimento no dia 31 quebraria ao avançar para um mês mais curto.
 */
export function advanceMonth(dateString: string): string {
  const parsed = parseISO(dateString);
  if (!parsed) return dateString;
  let { year, month } = parsed;

  month += 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }

  return formatISO(year, month, Math.min(parsed.day, daysInMonth(year, month)));
}

/** Avança uma data ISO em `days` dias, usando `Date` com componentes numéricos (hora local, sem parse de string UTC). */
export function advanceDays(dateString: string, days: number): string {
  const parsed = parseISO(dateString);
  if (!parsed) return dateString;
  // `new Date(y, mIndex, d)` usa componentes locais — diferente de `new Date('YYYY-MM-DD')`,
  // que seria interpretado como UTC. O construtor normaliza o excesso de dias sozinho
  // (ex.: 30/jan + 7 → 6/fev), inclusive virando mês e ano.
  const d = new Date(parsed.year, parsed.month - 1, parsed.day + days);
  return formatISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * Avança uma data ISO em exatamente um ano. O dia é clampado quando a data de origem é
 * 29/fev e o ano de destino não é bissexto (29/fev/2024 → 28/fev/2025) — sem o clamp, o
 * resultado seria "2025-02-29", uma data que não existe.
 */
export function advanceYear(dateString: string): string {
  const parsed = parseISO(dateString);
  if (!parsed) return dateString;
  const year = parsed.year + 1;
  return formatISO(year, parsed.month, Math.min(parsed.day, daysInMonth(year, parsed.month)));
}

/** Frequências suportadas por uma transação recorrente (ver FIN-053). */
export type RecurrenceFrequency = 'weekly' | 'monthly' | 'yearly';

/**
 * Calcula a próxima ocorrência de uma recorrência a partir de `dateString`, conforme a
 * frequência. Sempre retorna uma data estritamente posterior à de entrada, o que garante
 * o avanço do laço de "lançar pendentes" (FIN-054) mesmo em datas de borda como 29/fev.
 */
export function advanceOccurrence(dateString: string, frequency: RecurrenceFrequency): string {
  if (frequency === 'weekly') return advanceDays(dateString, 7);
  if (frequency === 'yearly') return advanceYear(dateString);
  return advanceMonth(dateString);
}

/**
 * Formata uma data ISO (YYYY-MM-DD) no padrão brasileiro para exibição.
 *
 * O `T12:00:00` (meio-dia) é essencial: `new Date('YYYY-MM-DD')` é interpretado como UTC
 * 00:00 e, num fuso negativo como o do Brasil (UTC-3), vira 21h do dia ANTERIOR — a data
 * exibida ficaria um dia atrás da real. Ancorar no meio-dia dá margem suficiente para
 * qualquer fuso do mundo cair no dia certo.
 */
export function formatDateBR(dateISO: string, options?: Intl.DateTimeFormatOptions): string {
  return new Date(dateISO + 'T12:00:00').toLocaleDateString('pt-BR', options);
}
