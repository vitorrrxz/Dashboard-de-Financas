// @vitest-environment node
// Validação dedicada do rate limit em si (FIN-007) — separada dos demais testes de auth
// (FIN-033) porque estes precisam de um limite alto para não se auto-bloquear ao fazer
// dezenas de register/login em sequência (ver test/backend-test-utils.js).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from './test/backend-test-utils.js';

describe('Rate limit em /api/auth (FIN-007)', () => {
  let app;
  let cleanup;
  const LIMIT = 3;

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('rate_limit', { authRateLimit: LIMIT }));
  });

  afterAll(() => cleanup());

  it(`bloqueia com 429 após ${LIMIT} tentativas de login na janela`, async () => {
    for (let i = 0; i < LIMIT; i++) {
      const res = await request(app).post('/api/auth/login').send({ email: 'x@x.com', password: 'errada' });
      expect(res.status).toBe(400); // credenciais inválidas, mas dentro do limite
    }
    const blocked = await request(app).post('/api/auth/login').send({ email: 'x@x.com', password: 'errada' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/muitas tentativas/i);
  });
});
