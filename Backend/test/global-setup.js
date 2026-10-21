// FIN-114 — roda uma vez para a execução inteira da suíte (não uma vez por arquivo, como antes):
// cria o schema atual no banco-modelo com `npx prisma db push`. Cada `createTestApp`
// (backend-test-utils.js) copia esse arquivo em vez de rodar o próprio `db push` — uma cópia de
// arquivo é ordens de magnitude mais rápida que subir o CLI/schema engine do Prisma de novo em
// cada um dos ~20 arquivos de teste de backend.
//
// Registrado em `test.globalSetup` (vitest.config.ts), que roda isolado do grafo de módulos dos
// testes — sem acesso a `describe`/`it`/mocks — antes de o primeiro arquivo de teste começar.
import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { TEST_TEMPLATE_DB } from './backend-test-utils.js';

export default async function setup() {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    if (existsSync(TEST_TEMPLATE_DB + suffix)) unlinkSync(TEST_TEMPLATE_DB + suffix);
  }

  // Sem `--accept-data-loss`: o arquivo acabou de ser apagado, então o push nunca tem dado a
  // perder (mesmo raciocínio de quando isto rodava por arquivo de teste, antes da FIN-114).
  execSync('npx prisma db push', {
    env: { ...process.env, DATABASE_URL: `file:${TEST_TEMPLATE_DB}` },
    stdio: 'pipe',
  });

  return async function teardown() {
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      if (existsSync(TEST_TEMPLATE_DB + suffix)) unlinkSync(TEST_TEMPLATE_DB + suffix);
    }
  };
}
