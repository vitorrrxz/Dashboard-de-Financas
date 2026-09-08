// @vitest-environment node
// FIN-031 — base de testes de integração do backend (Vitest + Supertest), banco SQLite
// isolado (`test_smoke.db`, nunca `dev.db`), destruído ao final da suíte.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from './test/backend-test-utils.js';

describe('server.js — smoke test', () => {
  let app;
  let cleanup;

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('smoke'));
  });

  afterAll(() => cleanup());

  it('GET /api/auth/me sem token retorna 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/token/i);
  });

  it('GET /api/auth/me com token inválido retorna 403', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer token-invalido');
    expect(res.status).toBe(403);
  });
});
