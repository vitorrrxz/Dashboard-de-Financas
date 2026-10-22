// @vitest-environment node
// FIN-122 — login com Google, GitHub e Microsoft (provedores sociais do Better Auth). O vaivém com o
// provedor de verdade não roda aqui; o que se testa é o que é do FinFlow: quais provedores ligam,
// para onde o login manda a pessoa e a conexão de provedores a uma conta que já existe.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import request from 'supertest';
import { createTestApp } from './test/backend-test-utils.js';

const ORIGIN = { Origin: 'http://localhost:5173' };
const APP = 'http://localhost:5173';

describe('Login social (FIN-122)', () => {
  let app;
  let prisma;
  let cleanup;

  beforeAll(async () => {
    // Google e GitHub configurados; Microsoft sem credenciais.
    ({ app, cleanup } = await createTestApp('social_login', { socialProviders: { google: true, github: true } }));
    ({ prisma } = await import('./server.js'));
  });

  afterAll(() => cleanup());

  const socialSignIn = body => request(app).post('/api/auth/sign-in/social').set(ORIGIN).send(body);

  it('lista só os provedores com credenciais', async () => {
    const res = await request(app).get('/api/auth/social-providers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ providers: ['google', 'github'] });
  });

  it('o login com o Google manda para a tela do Google, com o retorno no próprio FinFlow', async () => {
    const res = await socialSignIn({ provider: 'google', callbackURL: `${APP}/`, errorCallbackURL: `${APP}/` });
    expect(res.status).toBe(200);
    const url = new URL(res.body.url);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe('test-google-client');
    expect(url.searchParams.get('redirect_uri')).toMatch(/\/api\/auth\/callback\/google$/);
    expect(url.searchParams.get('prompt')).toBe('select_account');
    // PKCE e state: o código devolvido pelo Google só vale para quem começou o login.
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('o do GitHub pede o e-mail da conta', async () => {
    const res = await socialSignIn({ provider: 'github', callbackURL: '/' });
    const url = new URL(res.body.url);
    expect(url.origin).toBe('https://github.com');
    expect(url.searchParams.get('scope')).toContain('user:email');
  });

  it('provedor sem credenciais não existe', async () => {
    const res = await socialSignIn({ provider: 'microsoft', callbackURL: `${APP}/` });
    expect(res.status).toBe(404);
  });

  it('recusa endereço de retorno de outro site (redirecionamento aberto)', async () => {
    for (const field of ['callbackURL', 'errorCallbackURL', 'newUserCallbackURL']) {
      for (const evil of ['https://evil.example/', '//evil.example/', 'javascript:alert(1)']) {
        const res = await socialSignIn({ provider: 'google', callbackURL: `${APP}/`, [field]: evil });
        expect(res.status, `${field}=${evil}`).toBe(403);
        expect(res.body.code).toBe('INVALID_CALLBACK_URL');
      }
    }
  });

  it('retorno com erro do provedor volta para a tela do app, com o código do erro', async () => {
    const res = await request(app).get('/api/auth/callback/google?state=invalido&code=qualquer');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.origin).toBe(APP);
    expect(location.searchParams.get('error')).toBeTruthy();
  });

  describe('contas conectadas', () => {
    let cookie;
    let userId;

    beforeAll(async () => {
      const reg = await request(app).post('/api/auth/sign-up/email')
        .send({ name: 'Dona', email: 'dona@social.test', password: 'senha123' });
      cookie = reg.headers['set-cookie'];
      userId = reg.body.user.id;
    });

    it('conectar um provedor exige estar logado', async () => {
      const res = await request(app).post('/api/auth/link-social').set(ORIGIN).send({ provider: 'github', callbackURL: `${APP}/#settings` });
      expect(res.status).toBe(401);
    });

    it('logado, conectar manda para o provedor', async () => {
      const res = await request(app).post('/api/auth/link-social').set(ORIGIN).set('Cookie', cookie)
        .send({ provider: 'github', callbackURL: `${APP}/#settings` });
      expect(res.status).toBe(200);
      expect(new URL(res.body.url).origin).toBe('https://github.com');
    });

    it('conectar também recusa retorno para outro site', async () => {
      const res = await request(app).post('/api/auth/link-social').set(ORIGIN).set('Cookie', cookie)
        .send({ provider: 'github', callbackURL: 'https://evil.example/' });
      expect(res.status).toBe(403);
    });

    it('a lista de contas conectadas começa só com e-mail e senha, e ela não pode ser removida', async () => {
      const list = await request(app).get('/api/auth/list-accounts').set('Cookie', cookie);
      expect(list.body.map(a => a.providerId)).toEqual(['credential']);
      const res = await request(app).post('/api/auth/unlink-account').set(ORIGIN).set('Cookie', cookie)
        .send({ providerId: 'credential', accountId: list.body[0].accountId });
      expect(res.status).toBe(400);
    });

    it('provedor conectado aparece na lista e pode ser desconectado, sem mexer na senha', async () => {
      // O que o retorno do GitHub grava ao conectar (o vaivém com o provedor não roda no teste).
      const connection = await prisma.authAccount.create({
        data: { id: crypto.randomUUID(), accountId: 'gh-12345', providerId: 'github', userId },
      });
      const list = await request(app).get('/api/auth/list-accounts').set('Cookie', cookie);
      expect(list.body.map(a => a.providerId).sort()).toEqual(['credential', 'github']);

      const res = await request(app).post('/api/auth/unlink-account').set(ORIGIN).set('Cookie', cookie)
        .send({ accountId: connection.id }); // o id da conexão, não o da conta no GitHub
      expect(res.status).toBe(200);
      const after = await request(app).get('/api/auth/list-accounts').set('Cookie', cookie);
      expect(after.body.map(a => a.providerId)).toEqual(['credential']);
      const login = await request(app).post('/api/auth/sign-in/email').send({ email: 'dona@social.test', password: 'senha123' });
      expect(login.status).toBe(200);
    });
  });
});
