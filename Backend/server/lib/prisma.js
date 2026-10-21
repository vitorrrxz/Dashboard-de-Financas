import './env.js';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaLibSql } from '@prisma/adapter-libsql';

// FIN-120 — `libsql://` é o banco hospedado no Turso (deploy na Vercel, sem disco permanente);
// `file:` é o SQLite local do desenvolvimento, dos testes e do Docker. Mesmo schema nos dois.
const url = process.env.DATABASE_URL || 'file:./dev.db';
const adapter = url.startsWith('libsql://')
  ? new PrismaLibSql({ url, authToken: process.env.TURSO_AUTH_TOKEN })
  : new PrismaBetterSqlite3({ url });
export const prisma = new PrismaClient({ adapter });
