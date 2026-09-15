import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Config de teste separada de `vite.config.ts` (dev/build do frontend) — ver FIN-030 em
// docs/BACKLOG_DETAIL.md.
//
// FIN-114 — ambiente padrão `node`: a maioria dos testes (regras de negócio puras, os de
// backend) não toca em DOM nenhum, e criar um `jsdom` para cada um deles era quase um minuto
// da suíte à toa. Só os testes de componente/hook React que de fato renderizam algo pedem
// `jsdom`, com `// @vitest-environment jsdom` no topo do arquivo — o oposto do que valia antes
// (backend pedindo `node` explicitamente), porque agora `node` é que é o padrão.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    // FIN-114 — cria o banco-modelo (schema aplicado, sem linhas) uma vez para a suíte inteira;
    // cada teste de backend copia esse arquivo em vez de rodar `prisma db push` de novo (ver
    // test/global-setup.js e test/backend-test-utils.js).
    globalSetup: ['./test/global-setup.js'],
    globals: true,
    css: false,
    // Preparar um banco de teste (antes: `db push` por arquivo; agora: cópia do modelo) ainda
    // soma ao tempo de cada `beforeAll`, e o timeout padrão de 10s é insuficiente — mantido por
    // segurança mesmo com a cópia sendo bem mais rápida que o `db push` que ela substituiu.
    hookTimeout: 60000,
  },
});
