// Aritmética de datas ISO para o processamento de recorrências (FIN-054) e notificações
// (FIN-065 a FIN-069). Duplicado de `src/utils/dates.ts` pelo mesmo motivo de `toCents` em
// `money.js`: backend (Node puro) e frontend (bundle Vite/TS) não compartilham módulos neste
// projeto. Os testes de `src/utils/dates.test.ts` cobrem a versão canônica; os testes de
// backend cobrem o comportamento desta, via endpoint.
export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
export function daysInMonth(year, month) {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
export function formatISODate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Próxima ocorrência de uma recorrência, conforme a frequência. O dia é "clampado" ao
 * último dia válido do mês de destino (31/jan → 28 ou 29/fev; 29/fev → 28/fev no ano
 * seguinte), então nunca produz uma data inexistente, e o resultado é sempre estritamente
 * maior que a entrada — o que garante o avanço do laço de lançamento em
 * `/api/recurring-transactions/process`.
 */
export function advanceOccurrence(dateString, frequency) {
  const parts = dateString.split('-');
  if (parts.length !== 3) return dateString;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return dateString;
  if (month < 1 || month > 12 || day < 1) return dateString;

  if (frequency === 'weekly') {
    // `new Date(y, mIndex, d)` usa componentes locais (não faz parse UTC de string, ao
    // contrário de `new Date('YYYY-MM-DD')`) e normaliza sozinho a virada de mês/ano.
    const d = new Date(year, month - 1, day + 7);
    return formatISODate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  if (frequency === 'yearly') {
    return formatISODate(year + 1, month, Math.min(day, daysInMonth(year + 1, month)));
  }
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return formatISODate(nextYear, nextMonth, Math.min(day, daysInMonth(nextYear, nextMonth)));
}

/**
 * Data de hoje no fuso local do servidor, como string ISO — mesma convenção (e mesmo
 * motivo de não usar `toISOString()`, que é UTC) de `todayISO` em `src/utils/debts.ts`.
 */
export function todayISO() {
  const d = new Date();
  return formatISODate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Soma `days` dias a uma data ISO, com componentes locais (sem parse UTC de string). */
export function addDaysISO(dateString, days) {
  const [year, month, day] = dateString.split('-').map(Number);
  const d = new Date(year, month - 1, day + days);
  return formatISODate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Desloca uma chave de mês (YYYY-MM) em `delta` meses — espelho de `shiftMonth` em src/utils/dates.ts. */
export function shiftMonthKey(month, delta) {
  const [year, monthNumber] = month.split('-').map(Number);
  const absolute = year * 12 + (monthNumber - 1) + delta;
  const newYear = Math.floor(absolute / 12);
  return `${newYear}-${String(absolute - newYear * 12 + 1).padStart(2, '0')}`;
}

/** Nome do mês com inicial maiúscula ("Setembro"), montado com componentes numéricos. */
export function monthLabelPtBR(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const name = new Date(year, monthNumber - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
  return name.charAt(0).toUpperCase() + name.slice(1);
}
