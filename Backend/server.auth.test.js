// @vitest-environment node
// FIN-033/FIN-121 — testes de autenticação (Better Auth): cadastro, login e validação da sessão.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { createTestApp } from './test/backend-test-utils.js';

describe('Autenticação', () => {
  let app;
  let prisma;
  let cleanup;

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('auth'));
    ({ prisma } = await import('./server.js'));
  });

  afterAll(() => cleanup());

  describe('POST /api/auth/sign-up/email', () => {
    it('registra um usuário com dados válidos, com sessão em cookie httpOnly', async () => {
      const res = await request(app).post('/api/auth/sign-up/email')
        .send({ name: 'Fulano', email: 'fulano@auth.test', password: 'senha123' });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
      expect(res.body.user.email).toBe('fulano@auth.test');
      const cookie = res.headers['set-cookie'].find(c => c.startsWith('finflow.session_token='));
      expect(cookie).toMatch(/HttpOnly/i);
    });

    it('guarda a senha como hash bcrypt na credencial, nunca em texto puro', async () => {
      await request(app).post('/api/auth/sign-up/email')
        .send({ name: 'Hash', email: 'hash@auth.test', password: 'senha123' });
      const user = await prisma.user.findUnique({ where: { email: 'hash@auth.test' } });
      const credential = await prisma.authAccount.findFirst({ where: { userId: user.id, providerId: 'credential' } });
      expect(credential.password).toMatch(/^\$2[aby]\$/);
      expect(await bcrypt.compare('senha123', credential.password)).toBe(true);
    });

    it('rejeita e-mail duplicado (FIN-014: mensagem específica, decisão consciente)', async () => {
      await request(app).post('/api/auth/sign-up/email')
        .send({ name: 'Original', email: 'duplicado@auth.test', password: 'senha123' });
      const res = await request(app).post('/api/auth/sign-up/email')
        .send({ name: 'Outro', email: 'duplicado@auth.test', password: 'outrasenha' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL');
    });

    it('normaliza e-mail (lowercase) — duplicidade detectada mesmo com capitalização diferente (FIN-013)', async () => {
      await request(app).post('/api/auth/sign-up/email')
        .send({ name: 'Original', email: 'CaseTest@Auth.Test', password: 'senha123' });
      const res = await request(app).post('/api/auth/sign-up/email')
        .send({ name: 'Outro', email: 'casetest@auth.test', password: 'outrasenha' });
      expect(res.status).toBe(422);
    });

    it('rejeita senha curta (< 6 caracteres)', async () => {
      const res = await request(app).post('/api/auth/sign-up/email')
        .send({ name: 'Fulano', email: 'senhacurta@auth.test', password: '123' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PASSWORD_TOO_SHORT');
    });

    it('rejeita e-mail sem "@"', async () => {
      const res = await request(app).post('/api/auth/sign-up/email')
        .send({ name: 'Fulano', email: 'nao-e-email', password: 'senha123' });
      expect(res.status).toBe(400);
    });

    it('rejeita nome vazio', async () => {
      const res = await request(app).post('/api/auth/sign-up/email')
        .send({ name: '  ', email: 'semnome@auth.test', password: 'senha123' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('NAME_REQUIRED');
      expect(await prisma.user.findUnique({ where: { email: 'semnome@auth.test' } })).toBeNull();
    });
  });

  describe('POST /api/auth/sign-in/email', () => {
    beforeAll(async () => {
      await request(app).post('/api/auth/sign-up/email')
        .send({ name: 'Login Tester', email: 'login@auth.test', password: 'senhacorreta' });
    });

    it('login com credenciais corretas retorna token', async () => {
      const res = await request(app).post('/api/auth/sign-in/email')
        .send({ email: 'login@auth.test', password: 'senhacorreta' });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
    });

    it('login com senha incorreta retorna 401 com mensagem genérica (sem enumerar)', async () => {
      const res = await request(app).post('/api/auth/sign-in/email')
        .send({ email: 'login@auth.test', password: 'senhaerrada' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_EMAIL_OR_PASSWORD');
    });

    it('login com e-mail inexistente retorna a MESMA resposta que senha incorreta (sem enumerar contas)', async () => {
      const res = await request(app).post('/api/auth/sign-in/email')
        .send({ email: 'naoexiste@auth.test', password: 'qualquer' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_EMAIL_OR_PASSWORD');
    });

    it('conta de antes do Better Auth (hash bcrypt migrado para AuthAccount) entra com a mesma senha', async () => {
      // O que a migration 20261021180000_better_auth faz com cada usuário existente.
      const user = await prisma.user.create({ data: { name: 'Antigo', email: 'antigo@auth.test' } });
      await prisma.authAccount.create({
        data: {
          id: crypto.randomUUID(), accountId: user.id, providerId: 'credential', userId: user.id,
          password: await bcrypt.hash('senha-de-antes', 10),
        },
      });
      const res = await request(app).post('/api/auth/sign-in/email')
        .send({ email: 'antigo@auth.test', password: 'senha-de-antes' });
      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(user.id);
    });
  });

  describe('Proteção de rotas (sessão)', () => {
    let session;

    beforeAll(async () => {
      const reg = await request(app).post('/api/auth/sign-up/email')
        .send({ name: 'Acesso Valido', email: 'acessovalido@auth.test', password: 'senha123' });
      session = { token: reg.body.token, cookie: reg.headers['set-cookie'] };
    });

    it('acesso a rota protegida sem sessão retorna 401', async () => {
      const res = await request(app).get('/api/accounts');
      expect(res.status).toBe(401);
    });

    it('acesso com token inexistente retorna 401', async () => {
      const res = await request(app).get('/api/accounts').set('Authorization', 'Bearer nao-e-uma-sessao');
      expect(res.status).toBe(401);
    });

    it('cookie com assinatura falsa retorna 401 (garante que BETTER_AUTH_SECRET é realmente verificado)', async () => {
      const forged = `finflow.session_token=${session.token}.${Buffer.from('assinatura-falsa').toString('base64')}`;
      const res = await request(app).get('/api/accounts').set('Cookie', forged);
      expect(res.status).toBe(401);
    });

    it('sessão expirada retorna 401', async () => {
      const reg = await request(app).post('/api/auth/sign-up/email')
        .send({ name: 'Expira', email: 'expira@auth.test', password: 'senha123' });
      await prisma.session.updateMany({ where: { token: reg.body.token }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const res = await request(app).get('/api/accounts').set('Authorization', `Bearer ${reg.body.token}`);
      expect(res.status).toBe(401);
    });

    it('sessão válida dá acesso normalmente, pelo cookie e pelo token', async () => {
      const byCookie = await request(app).get('/api/accounts').set('Cookie', session.cookie);
      expect(byCookie.status).toBe(200);
      expect(Array.isArray(byCookie.body)).toBe(true);
      const byToken = await request(app).get('/api/accounts').set('Authorization', `Bearer ${session.token}`);
      expect(byToken.status).toBe(200);
    });

    it('logout encerra a sessão no servidor: o mesmo cookie deixa de valer', async () => {
      const login = await request(app).post('/api/auth/sign-in/email')
        .send({ email: 'acessovalido@auth.test', password: 'senha123' });
      const cookie = login.headers['set-cookie'];
      const out = await request(app).post('/api/auth/sign-out').set('Cookie', cookie).set('Origin', 'http://localhost:5173');
      expect(out.status).toBe(200);
      expect((await request(app).get('/api/accounts').set('Cookie', cookie)).status).toBe(401);
      expect(await prisma.session.findUnique({ where: { token: login.body.token } })).toBeNull();
    });
  });
});
