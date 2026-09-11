// FIN-079/FIN-080 — o arquivo de backup no navegador: reconhecer um backup do FinFlow, resumir o
// que ele contém (para a pessoa conferir antes de restaurar) e medir o tamanho que vai no envio.
// A validação completa, linha a linha, é do servidor.

export const BACKUP_FORMAT = 'finflow-backup';
export const BACKUP_VERSION = 1;
/** Limite do corpo da restauração no servidor (`BACKUP_BODY_LIMIT` em server.js). */
export const MAX_BACKUP_UPLOAD_BYTES = 25 * 1024 * 1024;

// Seções do arquivo, na ordem em que aparecem, com o nome no singular e no plural.
const SECTIONS = [
  ['accounts', 'conta', 'contas'],
  ['transactions', 'transação', 'transações'],
  ['debts', 'dívida', 'dívidas'],
  ['budgets', 'orçamento', 'orçamentos'],
  ['goals', 'meta', 'metas'],
  ['recurring', 'recorrência', 'recorrências'],
  ['investments', 'investimento', 'investimentos'],
] as const;

export type BackupSection = (typeof SECTIONS)[number][0];
export type BackupCounts = Record<BackupSection, number>;

export interface BackupSummary {
  exportedAt: string | null;
  counts: BackupCounts;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Quantos registros de cada tipo o arquivo tem; `null` se não for um backup do FinFlow nesta versão. */
export function summarizeBackup(value: unknown): BackupSummary | null {
  if (!isRecord(value) || value.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION || !isRecord(value.data)) {
    return null;
  }
  const counts = {} as BackupCounts;
  for (const [key] of SECTIONS) {
    const rows = value.data[key];
    if (!Array.isArray(rows)) return null;
    counts[key] = rows.length;
  }
  return { exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : null, counts };
}

/** Contagens da resposta de `POST /api/account/import`; `null` se vierem fora do formato. */
export function parseRestoreResult(body: unknown): BackupCounts | null {
  if (!isRecord(body) || !isRecord(body.restored)) return null;
  const counts = {} as BackupCounts;
  for (const [key] of SECTIONS) {
    const n = body.restored[key];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return null;
    counts[key] = n;
  }
  return counts;
}

/** "2 contas, 1.500 transações, 1 meta" — só os tipos que têm registro. */
export function describeBackupCounts(counts: BackupCounts): string {
  const parts = SECTIONS
    .filter(([key]) => counts[key] > 0)
    .map(([key, one, many]) => `${counts[key].toLocaleString('pt-BR')} ${counts[key] === 1 ? one : many}`);
  return parts.length > 0 ? parts.join(', ') : 'nenhum registro';
}

/** "Backup de 11/09/2026 12:30: 2 contas, 1 transação." */
export function describeBackupSummary(summary: BackupSummary): string {
  const date = summary.exportedAt ? new Date(summary.exportedAt) : null;
  const when = date && !Number.isNaN(date.getTime())
    ? `Backup de ${date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
    : 'Backup sem data';
  return `${when}: ${describeBackupCounts(summary.counts)}.`;
}

/**
 * Bytes do backup como ele vai no corpo da restauração: JSON compacto em UTF-8. É o que o limite
 * do servidor mede — o arquivo em disco é formatado (maior), e acentos ocupam 2 bytes.
 */
export function backupUploadBytes(backup: unknown): number {
  return new Blob([JSON.stringify(backup)]).size;
}
