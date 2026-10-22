// @vitest-environment node
// FIN-078/FIN-121 — verificação em duas etapas pelo plugin twoFactor do Better Auth: ativar (senha →
// QR code e códigos de recuperação → confirmar com um código do aplicativo), entrar com o código ou
// com um código de recuperação, e desativar.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import * as OTPAuth from 'otpauth';
import { createTestApp } from './test/backend-test-utils.js';

// As rotas do Better Auth que mudam estado conferem a origem da requisição (trustedOrigins).
const ORIGIN = { Origin: 'http://localhost:5173' };

describe('Verificação em duas etapas (FIN-078/FIN-121)', () => {
  let app;
  let prisma;
  let cleanup;
  let counter = 0;

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('two_factor'));
    ({ prisma } = await import('./server.js'));
  });

  afterAll(() => cleanup());

  async function newUser() {
    counter += 1;
    const email = `pessoa${counter}@2fa.test`;
    const res = await request(app).post('/api/auth/sign-up/email').send({ name: `Pessoa ${counter}`, email, password: 'senha123' });
    expect(res.status).toBe(200);
    return { id: res.body.user.id, email, cookie: res.headers['set-cookie'] };
  }

  const post = (path, cookie, body) => request(app).post(path).set(ORIGIN).set('Cookie', cookie ?? []).send(body);
  const signIn = email => request(app).post('/api/auth/sign-in/email').set(ORIGIN).send({ email, password: 'senha123' });

  /** Ativa a verificação e devolve o gerador de códigos, os de recuperação e o cookie da sessão nova. */
  async function enable(user) {
    const setup = await post('/api/auth/two-factor/enable', user.cookie, { password: 'senha123' });
    expect(setup.status).toBe(200);
    const totp = OTPAuth.URI.parse(setup.body.totpURI);
    const confirm = await post('/api/auth/two-factor/verify-totp', user.cookie, { code: totp.generate() });
    expect(confirm.status).toBe(200);
    return { totp, backupCodes: setup.body.backupCodes, cookie: confirm.headers['set-cookie'] };
  }

  const isEnabled = async userId => (await prisma.user.findUnique({ where: { id: userId } })).twoFactorEnabled;

  describe('ativar', () => {
    it('exige sessão', async () => {
      const res = await post('/api/auth/two-factor/enable', null, { password: 'senha123' });
      expect(res.status).toBe(401);
    });

    it('senha errada é recusada e nada é criado', async () => {
      const user = await newUser();
      const res = await post('/api/auth/two-factor/enable', user.cookie, { password: 'errada' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PASSWORD');
      expect(await prisma.twoFactor.count({ where: { userId: user.id } })).toBe(0);
    });

    it('devolve a URI otpauth do FinFlow e 10 códigos de recuperação — segredo e códigos cifrados no banco', async () => {
      const user = await newUser();
      const res = await post('/api/auth/two-factor/enable', user.cookie, { password: 'senha123' });
      expect(res.status).toBe(200);
      const totp = OTPAuth.URI.parse(res.body.totpURI);
      expect(totp.issuer).toBe('FinFlow');
      expect(totp.label).toBe(user.email);
      expect(res.body.backupCodes).toHaveLength(10);
      expect(new Set(res.body.backupCodes).size).toBe(10);

      const stored = await prisma.twoFactor.findFirst({ where: { userId: user.id } });
      expect(stored.secret).not.toContain(totp.secret.base32);
      for (const code of res.body.backupCodes) expect(stored.backupCodes).not.toContain(code);
    });

    it('configuração não confirmada não muda o login', async () => {
      const user = await newUser();
      await post('/api/auth/two-factor/enable', user.cookie, { password: 'senha123' });
      expect(await isEnabled(user.id)).toBe(false);
      const login = await signIn(user.email);
      expect(login.status).toBe(200);
      expect(login.body.token).toBeTruthy();
    });

    it('código errado não ativa', async () => {
      const user = await newUser();
      await post('/api/auth/two-factor/enable', user.cookie, { password: 'senha123' });
      const res = await post('/api/auth/two-factor/verify-totp', user.cookie, { code: '000000' });
      expect(res.status).toBe(401);
      expect(await isEnabled(user.id)).toBe(false);
    });

    it('o código do aplicativo confirma e ativa', async () => {
      const user = await newUser();
      await enable(user);
      expect(await isEnabled(user.id)).toBe(true);
    });
  });

  describe('login com a verificação ativa', () => {
    let user;
    let factors;

    beforeAll(async () => {
      user = await newUser();
      factors = await enable(user);
    });

    it('senha certa sem código: pede o segundo fator e não entrega sessão', async () => {
      const login = await signIn(user.email);
      expect(login.status).toBe(200);
      expect(login.body).toEqual({ twoFactorRedirect: true, twoFactorMethods: ['totp'] });
      expect(login.body.token).toBeUndefined();
      expect((await request(app).get('/api/accounts').set('Cookie', login.headers['set-cookie'])).status).toBe(401);
    });

    it('senha errada recebe a resposta de sempre, sem revelar que a conta usa 2FA', async () => {
      const res = await request(app).post('/api/auth/sign-in/email').set(ORIGIN).send({ email: user.email, password: 'errada' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_EMAIL_OR_PASSWORD');
    });

    it('código errado é recusado', async () => {
      const login = await signIn(user.email);
      const res = await post('/api/auth/two-factor/verify-totp', login.headers['set-cookie'], { code: '000000' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CODE');
    });

    it('senha e código certos: entra, e a sessão vale nas rotas protegidas', async () => {
      const login = await signIn(user.email);
      const res = await post('/api/auth/two-factor/verify-totp', login.headers['set-cookie'], { code: factors.totp.generate() });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
      expect((await request(app).get('/api/accounts').set('Cookie', res.headers['set-cookie'])).status).toBe(200);
    });

    it('o segundo passo de um login só vale uma vez', async () => {
      const login = await signIn(user.email);
      const pending = login.headers['set-cookie'];
      expect((await post('/api/auth/two-factor/verify-totp', pending, { code: factors.totp.generate() })).status).toBe(200);
      const again = await post('/api/auth/two-factor/verify-totp', pending, { code: factors.totp.generate() });
      expect(again.status).toBe(401);
    });

    it('código de recuperação entra uma vez só', async () => {
      const [code] = factors.backupCodes;
      const first = await signIn(user.email);
      expect((await post('/api/auth/two-factor/verify-backup-code', first.headers['set-cookie'], { code })).status).toBe(200);
      const second = await signIn(user.email);
      const reused = await post('/api/auth/two-factor/verify-backup-code', second.headers['set-cookie'], { code });
      expect(reused.status).toBe(401);
      expect(reused.body.code).toBe('INVALID_BACKUP_CODE');
    });

    it('isolamento: a ativação de um usuário não afeta o outro', async () => {
      const other = await newUser();
      const login = await signIn(other.email);
      expect(login.body.token).toBeTruthy();
    });
  });

  describe('desativar', () => {
    it('senha errada é recusada e a verificação continua ativa', async () => {
      const user = await newUser();
      const { cookie } = await enable(user);
      const res = await post('/api/auth/two-factor/disable', cookie, { password: 'errada' });
      expect(res.status).toBe(400);
      expect(await isEnabled(user.id)).toBe(true);
    });

    it('com a senha, desativa e o login volta a ser só com senha', async () => {
      const user = await newUser();
      const { cookie } = await enable(user);
      const res = await post('/api/auth/two-factor/disable', cookie, { password: 'senha123' });
      expect(res.status).toBe(200);
      expect(await isEnabled(user.id)).toBe(false);
      const login = await signIn(user.email);
      expect(login.body.token).toBeTruthy();
    });
  });
});
