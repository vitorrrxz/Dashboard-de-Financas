import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Config de teste separada de `vite.config.ts` (dev/build do frontend) — ver FIN-030 em
// docs/BACKLOG_DETAIL.md. Ambiente padrão `jsdom` (necessário para os testes de
// componente React); os testes de backend (raiz do repo, `server.*.test.js`) sobrescrevem
// para `node` via `// @vitest-environment node` no topo do arquivo, ver FIN-031.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    css: false,
    // Os testes de backend (server.*.test.js) rodam `npx prisma db push` num `beforeAll`
    // para preparar um banco SQLite isolado — com vários arquivos de teste em paralelo,
    // isso pode levar mais que o timeout padrão de 10s neste ambiente (ver FIN-031).
    hookTimeout: 30000,
    // Mesmo com 30s de hookTimeout, rodar 5+ arquivos de backend em paralelo (cada um
    // disparando seu próprio `npx prisma db push` via `execSync`) satura CPU/IO o
    // suficiente para estourar o timeout de qualquer forma nesta máquina — não é uma
    // race condition no código, é contenção de recursos do próprio ambiente de teste.
    // Roda os arquivos de teste sequencialmente (mais lento no total, mas confiável) em
    // vez de tentar compensar com um timeout ainda maior.
    fileParallelism: false,
  },
});
