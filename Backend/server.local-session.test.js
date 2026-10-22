// @vitest-environment node
// Login desativado temporariamente — POST /api/auth/local-session.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from './test/backend-test-utils.js';

describe('/api/auth/local-session', () => {
  let app;
  let cleanup;

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('local-session'));
  });

  afterAll(() => cleanup());
  // O .env local pode ligar a chave; cada teste parte dela desligada.
  beforeEach(() => { process.env.VITE_AUTH_DISABLED = 'false'; });

  it('não existe sem VITE_AUTH_DISABLED', async () => {
    const res = await request(app).post('/api/auth/local-session');
    expect(res.status).toBe(404);
  });

  it('com a chave ligada, entra na conta do primeiro usuário', async () => {
    const reg = await request(app).post('/api/auth/sign-up/email')
      .send({ name: 'Dono', email: 'dono@local-session.test', password: 'senha123' });
    expect(reg.status).toBe(200);

    process.env.VITE_AUTH_DISABLED = 'true';
    const res = await request(app).post('/api/auth/local-session');
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('dono@local-session.test');

    // A sessão vale pelo cookie (o navegador) e pelo token (clientes da API).
    expect(res.headers['set-cookie']?.join(';')).toMatch(/finflow\.session_token=/);
    const me = await request(app).get('/api/auth/get-session').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.body.user.email).toBe('dono@local-session.test');
    expect((await request(app).get('/api/accounts').set('Cookie', res.headers['set-cookie'])).status).toBe(200);
  });

  it('continua desligada em produção', async () => {
    process.env.VITE_AUTH_DISABLED = 'true';
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await request(app).post('/api/auth/local-session');
      expect(res.status).toBe(404);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
