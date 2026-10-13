// @vitest-environment node
// FIN-102 — backup do banco: cópia íntegra e restaurável, rotação que só toca nas próprias cópias,
// e falha que não derruba o servidor.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { runBackup, runBackupSafely } from '../scripts/backup-db.mjs';

let dir;
let databaseUrl;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finflow-backup-'));
  const file = path.join(dir, 'origem.db');
  const db = new Database(file);
  db.exec("CREATE TABLE conta (id INTEGER PRIMARY KEY, nome TEXT); INSERT INTO conta (nome) VALUES ('Corrente'), ('Poupança');");
  db.close();
  databaseUrl = `file:${file}`;
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('backup do banco (FIN-102)', () => {
  it('grava uma cópia íntegra que, restaurada, tem os mesmos dados', () => {
    const backupDir = path.join(dir, 'backups', 'nova'); // a pasta ainda não existe
    const { file } = runBackup({ databaseUrl, backupDir, now: new Date(2026, 0, 2, 3, 4, 5) });
    expect(path.basename(file)).toBe('finflow-2026-01-02T03-04-05.db');

    // Restaurar = copiar o backup por cima do banco, como descreve o README.
    const restored = path.join(dir, 'restaurado.db');
    fs.copyFileSync(file, restored);
    const db = new Database(restored, { readonly: true });
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(db.prepare('SELECT nome FROM conta ORDER BY id').all().map(row => row.nome)).toEqual(['Corrente', 'Poupança']);
    db.close();
  });

  it('mantém só as N cópias mais recentes e não toca em outros arquivos da pasta', () => {
    const backupDir = path.join(dir, 'backups');
    fs.mkdirSync(backupDir);
    const old = ['finflow-2025-01-01T00-00-00.db', 'finflow-2025-02-01T00-00-00.db', 'finflow-2025-03-01T00-00-00.db'];
    for (const name of [...old, 'anotacoes.txt', 'dev.db.bak-manual']) fs.writeFileSync(path.join(backupDir, name), '');

    const { removed } = runBackup({ databaseUrl, backupDir, keep: '2', now: new Date(2026, 0, 1) });
    expect(removed).toEqual(old.slice(0, 2));
    expect(fs.readdirSync(backupDir).sort()).toEqual([
      'anotacoes.txt', 'dev.db.bak-manual', 'finflow-2025-03-01T00-00-00.db', 'finflow-2026-01-01T00-00-00.db',
    ]);
  });

  it('BACKUP_KEEP absurdo nunca apaga a cópia recém-gravada', () => {
    fs.writeFileSync(path.join(dir, 'finflow-2025-01-01T00-00-00.db'), '');
    const { file } = runBackup({ databaseUrl, backupDir: dir, keep: '-5', now: new Date(2026, 0, 1) });
    expect(fs.readdirSync(dir).filter(name => name.startsWith('finflow-'))).toEqual([path.basename(file)]);
  });

  it('não sobrescreve uma cópia do mesmo segundo', () => {
    const now = new Date(2026, 0, 1);
    const { file } = runBackup({ databaseUrl, backupDir: dir, now });
    const before = fs.readFileSync(file);
    expect(() => runBackup({ databaseUrl, backupDir: dir, now })).toThrow();
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });

  it('recusa configuração inválida; no servidor, a falha só vai para o log', () => {
    expect(() => runBackup({ databaseUrl, backupDir: '' })).toThrow('BACKUP_DIR');
    expect(() => runBackup({ databaseUrl: 'postgresql://localhost/finflow', backupDir: dir })).toThrow('arquivo local');
    expect(() => runBackup({ databaseUrl: `file:${path.join(dir, 'nao-existe.db')}`, backupDir: dir })).toThrow();
    expect(fs.existsSync(path.join(dir, 'nao-existe.db'))).toBe(false);

    const notADirectory = path.join(dir, 'arquivo.txt');
    fs.writeFileSync(notADirectory, '');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(runBackupSafely({ databaseUrl, backupDir: notADirectory })).toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Falha no backup do banco'));
  });
});
