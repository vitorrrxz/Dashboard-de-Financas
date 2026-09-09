// Utilitário compartilhado pelos testes de integração do backend (FIN-031 em
// docs/BACKLOG_DETAIL.md). Cada arquivo de teste chama `createTestApp(nomeUnico)` UMA VEZ
// em `beforeAll`, o que: (1) aponta `DATABASE_URL` para um arquivo SQLite isolado,
// nunca `dev.db`; (2) aplica o schema atual via `prisma db push`; (3) importa `server.js`
// dinamicamente — import dinâmico, não `import` estático no topo do arquivo, porque os
// módulos ESM avaliam `import`s antes de qualquer código do teste rodar, e `server.js` lê
// `DATABASE_URL`/`JWT_SECRET` do ambiente no momento em que é carregado. O Vitest isola o
// registro de módulos por arquivo de teste (por padrão), então cada arquivo de teste que
// chama isto recebe sua própria instância de `server.js`/Prisma, sem vazar estado entre
// suítes.
import { execSync } from 'child_process';
import { unlinkSync, existsSync } from 'fs';

// Exportado para que testes que precisam assinar seus próprios tokens (ex.: token
// expirado/forjado em server.auth.test.js) usem o MESMO segredo que `server.js` valida em
// tempo de teste, sem duplicar o literal — evita os dois valores divergirem silenciosamente.
export const TEST_JWT_SECRET = 'test_jwt_secret_' + 'x'.repeat(40); // >= 32 chars, exigido por server.js

export async function createTestApp(dbName, { authRateLimit } = {}) {
  const dbFile = `./test_${dbName}.db`;
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    if (existsSync(dbFile + suffix)) unlinkSync(dbFile + suffix);
  }

  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.PLUGGY_CLIENT_ID = '';
  process.env.PLUGGY_CLIENT_SECRET = '';
  process.env.FRONTEND_URL = 'http://localhost:5173';
  // Testes de auth/isolamento fazem dezenas de register/login em sequência contra o mesmo
  // app — sem um limite alto aqui, o rate limit de produção (10/15min, ver FIN-007)
  // derrubaria a própria suíte de testes com 429. `authRateLimit` permite o inverso: um
  // teste dedicado a validar o rate limit em si passa um valor baixo proposital.
  process.env.AUTH_RATE_LIMIT = String(authRateLimit ?? 1000);

  execSync('npx prisma db push --accept-data-loss', {
    env: process.env,
    stdio: 'pipe',
  });

  // Import estático (não dinâmico com variável) — o Vite não consegue analisar
  // estaticamente `import(`../server.js?x=${var}`)` para seu grafo de módulos. O Vitest já
  // isola o registro de módulos por arquivo de teste por padrão, então um único
  // `import()` deste caminho fixo por arquivo é suficiente para não vazar estado entre
  // suítes de teste.
  const { app, prisma } = await import('../server.js');

  return {
    app,
    cleanup: async () => {
      // Precisa desconectar antes de apagar o arquivo — o driver better-sqlite3 mantém o
      // arquivo aberto, e no Windows isso faz o `unlink` falhar com `EBUSY`.
      await prisma.$disconnect();
      for (const suffix of ['', '-journal', '-wal', '-shm']) {
        if (existsSync(dbFile + suffix)) unlinkSync(dbFile + suffix);
      }
    },
  };
}
