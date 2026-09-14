#!/usr/bin/env node
// FIN-102 — cópia do banco SQLite para BACKUP_DIR, com rotação. `VACUUM INTO` numa conexão
// somente leitura grava um arquivo novo e consistente mesmo com o servidor rodando; copiar o
// `dev.db` aberto pode pegar uma escrita pela metade. Uso: `npm run backup`, ou pelo server.js
// (uma cópia ao subir e outra a cada 24 h).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

/** `finflow-2026-09-14T03-00-00.db`: hora local; ordem alfabética = ordem cronológica. */
const BACKUP_FILE = /^finflow-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.db$/;

function backupFileName(date) {
  const pad = n => String(n).padStart(2, '0');
  return `finflow-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}.db`;
}

const tableNames = db => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(row => row.name);

/** Grava a cópia, confere e apaga as antigas além de `keep`. Lança em qualquer problema. */
export function runBackup({
  databaseUrl = process.env.DATABASE_URL || 'file:./dev.db',
  backupDir = process.env.BACKUP_DIR,
  keep = process.env.BACKUP_KEEP,
  now = new Date(),
} = {}) {
  if (!backupDir) throw new Error('BACKUP_DIR não definido.');
  if (!databaseUrl.startsWith('file:')) throw new Error(`DATABASE_URL não é um arquivo local: ${databaseUrl}`);
  // ponytail: valor inválido cai no padrão em silêncio; o mínimo é 1, e a mais nova é a recém-gravada.
  const limit = Math.max(1, parseInt(keep, 10) || 30);
  const dir = path.resolve(backupDir);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, backupFileName(now));

  // `fileMustExist`: sem ele, um caminho errado criaria um banco vazio — e faria o backup dele.
  const db = new Database(databaseUrl.slice('file:'.length), { readonly: true, fileMustExist: true });
  let expected;
  try {
    db.prepare('VACUUM INTO ?').run(target); // falha se `target` já existe: nunca sobrescreve
    expected = tableNames(db);
  } finally {
    db.close();
  }

  try {
    const copy = new Database(target, { readonly: true, fileMustExist: true });
    try {
      const integrity = copy.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') throw new Error(`integrity_check: ${integrity}`);
      if (tableNames(copy).join() !== expected.join()) throw new Error('as tabelas da cópia não batem com as do banco');
    } finally {
      copy.close();
    }
  } catch (err) {
    // Cópia ruim sai da pasta: na rotação, ela empurraria para fora um backup bom.
    fs.rmSync(target, { force: true });
    throw new Error(`cópia descartada — ${err.message}`);
  }

  const removed = fs.readdirSync(dir).filter(name => BACKUP_FILE.test(name)).sort().slice(0, -limit);
  for (const name of removed) fs.unlinkSync(path.join(dir, name));
  return { file: target, bytes: fs.statSync(target).size, removed };
}

/** Para o servidor: uma falha de backup só vai para o log, sem derrubar o app. */
export function runBackupSafely(options) {
  try {
    const result = runBackup(options);
    console.log(`Backup do banco: ${result.file} (${Math.ceil(result.bytes / 1024)} kB; ${result.removed.length} cópia(s) antiga(s) apagada(s)).`);
    return result;
  } catch (err) {
    console.error(`Falha no backup do banco: ${err.message}`);
    return null;
  }
}

// `npm run backup`: sai com código 1 na falha, para um agendador do sistema perceber.
if (process.argv[1] === fileURLToPath(import.meta.url) && runBackupSafely() === null) process.exit(1);
