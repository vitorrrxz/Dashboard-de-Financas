// @vitest-environment node
// Validação dedicada do rate limit em si (FIN-007) — separada dos demais testes de auth
// (FIN-033) porque estes precisam de um limite alto para não se auto-bloquear ao fazer
// dezenas de register/login em sequência (ver test/backend-test-utils.js). Desde a FIN-121,
// o limite das rotas de login é o do Better Auth, contado no banco.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from './test/backend-test-utils.js';

describe('Rate limit em /api/auth (FIN-007)', () => {
  let app;
  let prisma;
  let cleanup;
  const LIMIT = 3;

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('rate_limit', { authRateLimit: LIMIT }));
    ({ prisma } = await import('./server.js'));
  });

  afterAll(() => cleanup());

  const signIn = ip => request(app).post('/api/auth/sign-in/email').set('X-Forwarded-For', ip)
    .send({ email: 'x@x.com', password: 'errada' });

  it(`bloqueia com 429 após ${LIMIT} tentativas de login na janela`, async () => {
    for (let i = 0; i < LIMIT; i++) {
      expect((await signIn('203.0.113.1')).status).toBe(401); // credenciais inválidas, mas dentro do limite
    }
    const blocked = await signIn('203.0.113.1');
    expect(blocked.status).toBe(429);
    // Contagem no banco, e não na memória de uma instância (FIN-120: várias na Vercel).
    expect(await prisma.rateLimit.count()).toBeGreaterThan(0);
  });

  it('conta por IP: outro visitante não é bloqueado', async () => {
    expect((await signIn('203.0.113.2')).status).toBe(401);
  });

  it('vale também para os códigos da verificação em duas etapas', async () => {
    const verify = () => request(app).post('/api/auth/two-factor/verify-totp').set('X-Forwarded-For', '203.0.113.3')
      .send({ code: '000000' });
    for (let i = 0; i < LIMIT; i++) expect((await verify()).status).not.toBe(429);
    expect((await verify()).status).toBe(429);
  });
});
