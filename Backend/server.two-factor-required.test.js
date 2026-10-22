// @vitest-environment node
// FIN-123 — verificação em duas etapas obrigatória: sem ela ativa, a sessão só serve para ativá-la; com
// ela ativa, todo login pede o código do aplicativo — inclusive o do Google/GitHub, que antes pulava
// esse passo.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import request from 'supertest';
import * as OTPAuth from 'otpauth';
import { createTestApp } from './test/backend-test-utils.js';

const APP = 'http://localhost:5173';
const ORIGIN = { Origin: APP };

describe('Verificação em duas etapas obrigatória (FIN-123)', () => {
  let app;
  let prisma;
  let cleanup;
  let counter = 0;

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('two_factor_required', { twoFactorRequired: true, socialProviders: { github: true } }));
    ({ prisma } = await import('./server.js'));
  });

  afterAll(() => cleanup());
  afterEach(() => vi.restoreAllMocks());

  const post = (path, cookie, body) => request(app).post(path).set(ORIGIN).set('Cookie', cookie ?? []).send(body);

  async function newUser() {
    counter += 1;
    const email = `pessoa${counter}@obrigatorio.test`;
    const res = await request(app).post('/api/auth/sign-up/email').send({ name: `Pessoa ${counter}`, email, password: 'senha123' });
    expect(res.status).toBe(200);
    return { id: res.body.user.id, email, cookie: res.headers['set-cookie'] };
  }

  async function enable(user, body = { password: 'senha123' }) {
    const setup = await post('/api/auth/two-factor/enable', user.cookie, body);
    expect(setup.status).toBe(200);
    const totp = OTPAuth.URI.parse(setup.body.totpURI);
    const confirm = await post('/api/auth/two-factor/verify-totp', user.cookie, { code: totp.generate() });
    expect(confirm.status).toBe(200);
    return { totp, cookie: confirm.headers['set-cookie'] };
  }

  it('a tela fica sabendo que a verificação é obrigatória', async () => {
    const res = await request(app).get('/api/auth/two-factor-policy');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ required: true });
  });

  it('sem a verificação ativa, as rotas do app respondem 403 até ativá-la', async () => {
    const user = await newUser();
    const blocked = await request(app).get('/api/accounts').set('Cookie', user.cookie);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('TWO_FACTOR_SETUP_REQUIRED');

    const { cookie } = await enable(user);
    const allowed = await request(app).get('/api/accounts').set('Cookie', cookie);
    expect(allowed.status).toBe(200);
  });

  it('sem sessão, continua 401', async () => {
    const res = await request(app).get('/api/accounts');
    expect(res.status).toBe(401);
  });

  it('não dá para desativar', async () => {
    const user = await newUser();
    const { cookie } = await enable(user);
    const res = await post('/api/auth/two-factor/disable', cookie, { password: 'senha123' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TWO_FACTOR_REQUIRED');
    expect((await prisma.user.findUnique({ where: { id: user.id } })).twoFactorEnabled).toBe(true);
  });

  it('trocar de celular: com a senha, o mesmo QR code aparece de novo', async () => {
    const user = await newUser();
    const { totp, cookie } = await enable(user);
    const wrong = await post('/api/auth/two-factor/get-totp-uri', cookie, { password: 'errada' });
    expect(wrong.status).toBe(400);
    const res = await post('/api/auth/two-factor/get-totp-uri', cookie, { password: 'senha123' });
    expect(res.status).toBe(200);
    expect(OTPAuth.URI.parse(res.body.totpURI).secret.base32).toBe(totp.secret.base32);
  });

  it('com senha, ativar continua pedindo a senha', async () => {
    const user = await newUser();
    const res = await post('/api/auth/two-factor/enable', user.cookie, {});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PASSWORD');
  });

  describe('login pelo GitHub', () => {
    let state = 0;

    /** Faz o vaivém com o GitHub, com as respostas dele simuladas para a conta `githubId`. */
    async function signInWithGitHub(githubId, email) {
      const realFetch = globalThis.fetch;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input instanceof Request ? input.url : input);
        const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
        if (url.startsWith('https://github.com/login/oauth/access_token')) {
          return json({ access_token: `gho_${++state}`, token_type: 'bearer', scope: 'read:user,user:email' });
        }
        if (url === 'https://api.github.com/user') return json({ id: githubId, login: `gh${githubId}`, name: 'Pessoa GitHub', email, avatar_url: '' });
        if (url === 'https://api.github.com/user/emails') return json([{ email, primary: true, verified: true }]);
        return realFetch(input, init);
      });
      const start = await request(app).post('/api/auth/sign-in/social').set(ORIGIN)
        .send({ provider: 'github', callbackURL: `${APP}/`, errorCallbackURL: `${APP}/` });
      expect(start.status).toBe(200);
      const oauthState = new URL(start.body.url).searchParams.get('state');
      return request(app).get(`/api/auth/callback/github?code=codigo&state=${oauthState}`).set('Cookie', start.headers['set-cookie']);
    }

    const cookieNames = res => (res.headers['set-cookie'] ?? []).filter(c => !/Max-Age=0/.test(c)).map(c => c.split('=')[0]);

    it('com a verificação ativa, a volta do provedor pede o código em vez de abrir a sessão', async () => {
      const user = await newUser();
      const { totp } = await enable(user);
      const githubId = 1000 + counter;
      await prisma.authAccount.create({
        data: { id: crypto.randomUUID(), accountId: String(githubId), providerId: 'github', userId: user.id },
      });
      const sessionsBefore = await prisma.session.count({ where: { userId: user.id } });

      const callback = await signInWithGitHub(githubId, user.email);
      expect(callback.status).toBe(302);
      expect(callback.headers.location).toBe(`${APP}/?twoFactor=1`);
      expect(cookieNames(callback)).toContain('finflow.two_factor');
      expect(cookieNames(callback)).not.toContain('finflow.session_token');
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(sessionsBefore);

      // O cookie do desafio sozinho não abre o app.
      const pending = callback.headers['set-cookie'];
      expect((await request(app).get('/api/accounts').set('Cookie', pending)).status).toBe(401);

      const wrong = await post('/api/auth/two-factor/verify-totp', pending, { code: '000000' });
      expect(wrong.status).toBe(401);
      const verified = await post('/api/auth/two-factor/verify-totp', pending, { code: totp.generate() });
      expect(verified.status).toBe(200);
      expect(verified.body.user.id).toBe(user.id);
      const res = await request(app).get('/api/accounts').set('Cookie', verified.headers['set-cookie']);
      expect(res.status).toBe(200);
    });

    it('conta nova pelo GitHub entra direto, mas só para ativar a verificação (sem senha)', async () => {
      const callback = await signInWithGitHub(5000, 'nova@github.test');
      expect(callback.status).toBe(302);
      expect(callback.headers.location).toBe(`${APP}/`);
      const cookie = callback.headers['set-cookie'];
      expect((await request(app).get('/api/accounts').set('Cookie', cookie)).status).toBe(403);

      // Sem senha cadastrada, ativar não pede senha.
      const { cookie: enabledCookie } = await enable({ cookie }, {});
      expect((await request(app).get('/api/accounts').set('Cookie', enabledCookie)).status).toBe(200);
    });
  });
});
