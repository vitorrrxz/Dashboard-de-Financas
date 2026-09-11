import { describe, it, expect } from 'vitest';
import {
  backupUploadBytes, describeBackupCounts, describeBackupSummary, parseRestoreResult, summarizeBackup, type BackupCounts,
} from './backup';

const EMPTY: BackupCounts = { accounts: 0, transactions: 0, debts: 0, budgets: 0, goals: 0, recurring: 0, investments: 0 };
const data = { accounts: [{}, {}], transactions: [{}], debts: [], budgets: [], goals: [{}], recurring: [], investments: [] };

describe('summarizeBackup (FIN-080)', () => {
  it('conta os registros de cada seção de um backup do FinFlow', () => {
    expect(summarizeBackup({ format: 'finflow-backup', version: 1, exportedAt: '2026-09-11T12:00:00.000Z', data }))
      .toEqual({ exportedAt: '2026-09-11T12:00:00.000Z', counts: { ...EMPTY, accounts: 2, transactions: 1, goals: 1 } });
  });

  it('recusa outro formato, outra versão, seção ausente ou fora de lista', () => {
    const base = { format: 'finflow-backup', version: 1, data };
    for (const value of [
      null, 'texto', [base], { ...base, format: 'outro' }, { ...base, version: 2 }, { ...base, version: '1' },
      { ...base, data: undefined }, { ...base, data: { ...data, goals: undefined } }, { ...base, data: { ...data, debts: {} } },
    ]) {
      expect(summarizeBackup(value)).toBeNull();
    }
  });

  it('data de exportação ausente ou com tipo errado vira null, sem recusar o arquivo', () => {
    expect(summarizeBackup({ format: 'finflow-backup', version: 1, exportedAt: 42, data })?.exportedAt).toBeNull();
  });
});

describe('parseRestoreResult (FIN-080)', () => {
  it('aceita só contagens inteiras e não negativas de todas as seções', () => {
    expect(parseRestoreResult({ success: true, restored: { ...EMPTY, accounts: 3 } })).toEqual({ ...EMPTY, accounts: 3 });
    for (const body of [null, {}, { restored: [] }, { restored: { ...EMPTY, goals: undefined } }, { restored: { ...EMPTY, goals: -1 } }, { restored: { ...EMPTY, goals: 1.5 } }]) {
      expect(parseRestoreResult(body)).toBeNull();
    }
  });
});

describe('describeBackupCounts / describeBackupSummary (FIN-079)', () => {
  it('singular, plural, milhar e só os tipos com registro', () => {
    expect(describeBackupCounts({ ...EMPTY, accounts: 1, transactions: 1500, investments: 2 }))
      .toBe('1 conta, 1.500 transações, 2 investimentos');
    expect(describeBackupCounts(EMPTY)).toBe('nenhum registro');
  });

  it('resumo com a data de exportação, ou sem data quando ela falta ou é inválida', () => {
    const counts = { ...EMPTY, goals: 1 };
    expect(describeBackupSummary({ exportedAt: '2026-09-11T15:30:00.000Z', counts })).toMatch(/^Backup de \d{2}\/\d{2}\/\d{4},? \d{2}:\d{2}: 1 meta\.$/);
    expect(describeBackupSummary({ exportedAt: null, counts })).toBe('Backup sem data: 1 meta.');
    expect(describeBackupSummary({ exportedAt: 'ontem', counts })).toBe('Backup sem data: 1 meta.');
  });
});

describe('backupUploadBytes (FIN-080)', () => {
  it('mede o JSON compacto em UTF-8 — acento conta 2 bytes', () => {
    expect(backupUploadBytes({ a: 'c' })).toBe('{"a":"c"}'.length);
    expect(backupUploadBytes({ a: 'ç' })).toBe('{"a":"c"}'.length + 1);
  });
});
