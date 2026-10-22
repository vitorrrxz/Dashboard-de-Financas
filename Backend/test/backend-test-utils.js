// Utilitário compartilhado pelos testes de integração do backend (FIN-031 em
// docs/BACKLOG_DETAIL.md). Cada arquivo de teste chama `createTestApp(nomeUnico)` UMA VEZ
// em `beforeAll`, o que: (1) aponta `DATABASE_URL` para um arquivo SQLite isolado,
// nunca `dev.db`; (2) aplica o schema atual, copiando o banco-modelo já pronto (ver FIN-114
// e `global-setup.js`, que cria esse modelo uma vez com `prisma db push`, no início da
// suíte inteira); (3) importa `server.js` dinamicamente — import dinâmico, não `import`
// estático no topo do arquivo, porque os módulos ESM avaliam `import`s antes de qualquer
// código do teste rodar, e `server.js` lê `DATABASE_URL`/`BETTER_AUTH_SECRET` do ambiente no
// momento em que é carregado. O Vitest isola o registro de módulos por arquivo de teste
// (por padrão), então cada arquivo de teste que chama isto recebe sua própria instância de
// `server.js`/Prisma, sem vazar estado entre suítes.
import { copyFileSync, existsSync, unlinkSync } from 'fs';

// FIN-121 — segredo do Better Auth (assina os cookies de sessão e cifra os segredos do 2FA).
export const TEST_AUTH_SECRET = 'test_auth_secret_' + 'x'.repeat(40); // >= 32 chars, exigido pelo servidor
// FIN-114 — banco com o schema já aplicado (sem nenhuma linha), criado uma vez por
// `global-setup.js` antes de qualquer arquivo de teste rodar. Caminho fixo: é o único jeito de
// `global-setup.js` (roda isolado, fora do grafo de módulos dos testes) e este arquivo
// concordarem em onde ele está, sem um terceiro lugar para configurar o mesmo valor duas vezes.
export const TEST_TEMPLATE_DB = './test_template.db';

export async function createTestApp(dbName, { authRateLimit, frontendDir } = {}) {
  const dbFile = `./test_${dbName}.db`;
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    if (existsSync(dbFile + suffix)) unlinkSync(dbFile + suffix);
  }

  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.BETTER_AUTH_SECRET = TEST_AUTH_SECRET;
  process.env.PLUGGY_CLIENT_ID = '';
  process.env.PLUGGY_CLIENT_SECRET = '';
  process.env.FRONTEND_URL = 'http://localhost:5173';
  // Testes de auth/isolamento fazem dezenas de register/login em sequência contra o mesmo
  // app — sem um limite alto aqui, o rate limit de produção (10/15min, ver FIN-007)
  // derrubaria a própria suíte de testes com 429. `authRateLimit` permite o inverso: um
  // teste dedicado a validar o rate limit em si passa um valor baixo proposital.
  process.env.AUTH_RATE_LIMIT = String(authRateLimit ?? 1000);
  // FIN-108: pasta do build do frontend servida pela API. Sem `frontendDir`, vazia — mesmo que o .env de
  // quem roda os testes defina FRONTEND_DIR, porque o dotenv não sobrescreve variável que já existe.
  process.env.FRONTEND_DIR = frontendDir ?? '';

  // FIN-114 — copiar o banco-modelo (`-wal`/`-shm` inclusive, se sobrou algum do `db push` que o
  // criou) é ordens de magnitude mais rápido que rodar `npx prisma db push` de novo por arquivo de
  // teste: uma cópia de arquivo, em vez de subir o CLI e o schema engine do Prisma a cada suíte.
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(TEST_TEMPLATE_DB + suffix)) copyFileSync(TEST_TEMPLATE_DB + suffix, dbFile + suffix);
  }

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
