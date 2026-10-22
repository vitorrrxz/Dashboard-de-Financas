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

  it('rota protegida sem sessão retorna 401', async () => {
    const res = await request(app).get('/api/accounts');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/login/i);
  });

  it('rota protegida com token de sessão inválido retorna 401', async () => {
    const res = await request(app).get('/api/accounts').set('Authorization', 'Bearer token-invalido');
    expect(res.status).toBe(401);
  });

  it('sem FRONTEND_DIR, a API não serve o frontend — no desenvolvimento, é o Vite (FIN-108)', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(404);
  });
});
