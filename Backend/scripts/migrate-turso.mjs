#!/usr/bin/env node
// FIN-120 — `prisma migrate deploy` para o banco do Turso: o CLI do Prisma não aplica migrations numa
// URL `libsql://`. Aplica, em ordem, as pastas de Backend/prisma/migrations que ainda não estão em
// `_prisma_migrations`, gravando cada uma como o Prisma grava (checksum = sha256 do migration.sql) —
// assim o banco importado do `dev.db` continua com o mesmo histórico. Roda no build da Vercel
// (vercel.json); com DATABASE_URL local (`file:`), não faz nada: lá vale o `prisma migrate deploy`.
import '../server/lib/env.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@libsql/client';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'migrations');

const url = process.env.DATABASE_URL || '';
if (!url.startsWith('libsql://')) {
  console.log('DATABASE_URL não é do Turso (libsql://) — nada a migrar aqui.');
  process.exit(0);
}

const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
await db.execute(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
)`);

const { rows } = await db.execute('SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE rolled_back_at IS NULL');
// Migration que começou e não terminou: parar, como o Prisma faz, em vez de aplicar por cima.
const failed = rows.filter(row => row.finished_at === null).map(row => row.migration_name);
if (failed.length) throw new Error(`Migrations sem término registrado no banco: ${failed.join(', ')}. Resolva antes de continuar.`);
const applied = new Set(rows.map(row => row.migration_name));

const pending = fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && !applied.has(entry.name))
  .map(entry => entry.name)
  .sort();

for (const name of pending) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
  const checksum = crypto.createHash('sha256').update(sql).digest('hex');
  const startedAt = Date.now();
  // `executeMultiple` roda o arquivo inteiro numa transação: falhou, nada da migration fica no banco.
  await db.executeMultiple(`BEGIN;\n${sql}\nCOMMIT;`);
  await db.execute({
    sql: 'INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?, 1)',
    args: [crypto.randomUUID(), checksum, Date.now(), name, startedAt],
  });
  console.log(`Aplicada: ${name}`);
}
console.log(pending.length ? `${pending.length} migration(s) aplicada(s) no Turso.` : 'Banco do Turso já está em dia.');
db.close();
