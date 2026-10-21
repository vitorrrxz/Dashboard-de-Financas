// @vitest-environment node
// FIN-078 — verificação em duas etapas (TOTP): configuração, ativação, login com o segundo
// fator, códigos de recuperação, reuso de código, servidor sem a chave e desativação.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import * as OTPAuth from 'otpauth';
import { createTestApp, TEST_TWO_FACTOR_KEY } from './test/backend-test-utils.js';

// Início de um intervalo de 30 s + 10 s: "30 s antes" e "30 s depois" caem, sem ambiguidade,
// nos intervalos vizinhos.
const T0 = Date.UTC(2026, 8, 11, 12, 0, 10);
const STEP = 30_000;
const RECOVERY_CODE_FORMAT = /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/;

/** Código que o aplicativo autenticador mostraria para `secret` no instante `timestamp`. */
function codeAt(secret, timestamp) {
  return OTPAuth.TOTP.generate({ secret: OTPAuth.Secret.fromBase32(secret), timestamp });
}

describe('Verificação em duas etapas (FIN-078)', () => {
  let app;
  let cleanup;
  let prisma;
  let encryptTwoFactorSecret;
  let decryptTwoFactorSecret;
  let userCounter = 0;

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('two_factor'));
    ({ prisma, encryptTwoFactorSecret, decryptTwoFactorSecret } = await import('./server.js'));
  });

  afterAll(() => cleanup());

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env.TWO_FACTOR_ENCRYPTION_KEY = TEST_TWO_FACTOR_KEY;
  });

  async function newUser() {
    userCounter += 1;
    const email = `usuario${userCounter}@2fa.test`;
    const password = 'senha-forte-123';
    const res = await request(app).post('/api/auth/register').send({ name: `Usuário ${userCounter}`, email, password });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    return { email, password, token: res.body.token, id: res.body.user.id };
  }

  async function setup(user) {
    const res = await request(app).post('/api/auth/2fa/setup').set('Authorization', `Bearer ${user.token}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.secret).toBeTruthy();
    return res.body;
  }

  /** Configura e ativa com o código do instante atual; devolve o segredo e os códigos de recuperação. */
  async function enable(user) {
    const { secret } = await setup(user);
    const res = await request(app).post('/api/auth/2fa/enable').set('Authorization', `Bearer ${user.token}`)
      .send({ password: user.password, code: codeAt(secret, Date.now()) });
    expect(res.status).toBe(200);
    expect(res.body.recoveryCodes).toHaveLength(10);
    return { secret, recoveryCodes: res.body.recoveryCodes };
  }

  const login = (user, code) => request(app).post('/api/auth/login')
    .send({ email: user.email, password: user.password, ...(code !== undefined ? { code } : {}) });

  const status = user => request(app).get('/api/auth/2fa').set('Authorization', `Bearer ${user.token}`);

  describe('GET /api/auth/2fa', () => {
    it('exige autenticação', async () => {
      const res = await request(app).get('/api/auth/2fa');
      expect(res.status).toBe(401);
    });

    it('usuário novo: disponível no servidor e inativa', async () => {
      const user = await newUser();
      const res = await status(user);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ available: true, enabled: false, enabledAt: null, recoveryCodesRemaining: null });
    });
  });

  describe('POST /api/auth/2fa/setup', () => {
    it('devolve segredo, URI otpauth e QR code — e grava o segredo cifrado, amarrado ao usuário', async () => {
      const user = await newUser();
      const body = await setup(user);
      expect(body.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(body.otpauthUrl).toContain('otpauth://totp/FinFlow:');
      expect(body.otpauthUrl).toContain(encodeURIComponent(user.email));
      expect(body.otpauthUrl).toContain(`secret=${body.secret}`);
      expect(body.qrCode).toMatch(/^data:image\/gif;base64,/);

      const record = await prisma.userTwoFactor.findUnique({ where: { userId: user.id } });
      expect(record.enabledAt).toBeNull();
      expect(record.secret.startsWith('v1.')).toBe(true);
      expect(record.secret).not.toContain(body.secret);
      const { twoFactorKeyForTests } = await keyHelpers();
      expect(decryptTwoFactorSecret(record.secret, user.id, twoFactorKeyForTests)).toBe(body.secret);
    });

    it('configuração não confirmada não muda o login', async () => {
      const user = await newUser();
      await setup(user);
      const res = await login(user);
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
      expect(res.body.twoFactorRequired).toBeUndefined();
    });

    it('recomeçar a configuração troca o segredo — o código do segredo antigo não ativa', async () => {
      const user = await newUser();
      const first = await setup(user);
      const second = await setup(user);
      expect(second.secret).not.toBe(first.secret);

      const stale = await request(app).post('/api/auth/2fa/enable').set('Authorization', `Bearer ${user.token}`)
        .send({ password: user.password, code: codeAt(first.secret, Date.now()) });
      expect(stale.status).toBe(400);
      const fresh = await request(app).post('/api/auth/2fa/enable').set('Authorization', `Bearer ${user.token}`)
        .send({ password: user.password, code: codeAt(second.secret, Date.now()) });
      expect(fresh.status).toBe(200);
    });

    it('com a verificação ativa, recusa (409) e não mexe no segredo nem na ativação', async () => {
      const user = await newUser();
      await enable(user);
      const before = await prisma.userTwoFactor.findUnique({ where: { userId: user.id } });

      const res = await request(app).post('/api/auth/2fa/setup').set('Authorization', `Bearer ${user.token}`).send({});
      expect(res.status).toBe(409);
      const after = await prisma.userTwoFactor.findUnique({ where: { userId: user.id } });
      expect(after).toEqual(before);
    });
  });

  describe('POST /api/auth/2fa/enable', () => {
    it('senha errada é recusada e a verificação continua inativa', async () => {
      const user = await newUser();
      const { secret } = await setup(user);
      const res = await request(app).post('/api/auth/2fa/enable').set('Authorization', `Bearer ${user.token}`)
        .send({ password: 'senha-errada', code: codeAt(secret, Date.now()) });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/senha incorreta/i);
      expect((await status(user)).body.enabled).toBe(false);
    });

    it('código errado, ou fora do formato de 6 dígitos, é recusado', async () => {
      const user = await newUser();
      const { secret } = await setup(user);
      const valid = codeAt(secret, Date.now());
      const wrong = String((Number(valid) + 1) % 1_000_000).padStart(6, '0');
      for (const code of [wrong, '12345', 'abcdef', 123456]) {
        const res = await request(app).post('/api/auth/2fa/enable').set('Authorization', `Bearer ${user.token}`)
          .send({ password: user.password, code });
        expect(res.status).toBe(400);
      }
      expect((await status(user)).body.enabled).toBe(false);
    });

    it('sem configuração iniciada, pede para gerar o QR code', async () => {
      const user = await newUser();
      const res = await request(app).post('/api/auth/2fa/enable').set('Authorization', `Bearer ${user.token}`)
        .send({ password: user.password, code: '123456' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/QR code/);
    });

    it('ativa e devolve 10 códigos de recuperação distintos, guardados só como hash', async () => {
      const user = await newUser();
      const { recoveryCodes } = await enable(user);
      expect(new Set(recoveryCodes).size).toBe(10);
      for (const code of recoveryCodes) expect(code).toMatch(RECOVERY_CODE_FORMAT);

      const record = await prisma.userTwoFactor.findUnique({ where: { userId: user.id } });
      const stored = JSON.parse(record.recoveryCodes);
      expect(stored).toHaveLength(10);
      for (const code of recoveryCodes) {
        expect(record.recoveryCodes).not.toContain(code);
        expect(record.recoveryCodes).not.toContain(code.replace('-', ''));
      }
      const res = await status(user);
      expect(res.body).toMatchObject({ enabled: true, recoveryCodesRemaining: 10 });
      expect(res.body.enabledAt).toBeTruthy();
    });

    it('aceita o código do intervalo anterior (relógio atrasado), mas não o de 2 intervalos atrás', async () => {
      const tooOld = await newUser();
      const setupOld = await setup(tooOld);
      const rejected = await request(app).post('/api/auth/2fa/enable').set('Authorization', `Bearer ${tooOld.token}`)
        .send({ password: tooOld.password, code: codeAt(setupOld.secret, T0 - 2 * STEP) });
      expect(rejected.status).toBe(400);

      const late = await newUser();
      const setupLate = await setup(late);
      const accepted = await request(app).post('/api/auth/2fa/enable').set('Authorization', `Bearer ${late.token}`)
        .send({ password: late.password, code: codeAt(setupLate.secret, T0 - STEP) });
      expect(accepted.status).toBe(200);
    });
  });

  describe('login com a verificação ativa', () => {
    it('senha certa sem código: pede o segundo fator e não entrega token', async () => {
      const user = await newUser();
      await enable(user);
      const res = await login(user);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ twoFactorRequired: true });
    });

    it('senha errada recebe a mensagem de sempre, sem revelar que a conta usa 2FA', async () => {
      const user = await newUser();
      const { secret } = await enable(user);
      vi.setSystemTime(T0 + STEP);
      for (const code of [undefined, codeAt(secret, Date.now())]) {
        const res = await request(app).post('/api/auth/login')
          .send({ email: user.email, password: 'senha-errada', ...(code ? { code } : {}) });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Credenciais inválidas' });
      }
    });

    it('senha e código certos: entra, e o token vale nas rotas protegidas', async () => {
      const user = await newUser();
      const { secret } = await enable(user);
      vi.setSystemTime(T0 + STEP);
      const res = await login(user, codeAt(secret, Date.now()));
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
      expect(res.body.recoveryCodeUsed).toBeUndefined();
      const accounts = await request(app).get('/api/accounts').set('Authorization', `Bearer ${res.body.token}`);
      expect(accounts.status).toBe(200);
    });

    it('código errado é recusado', async () => {
      const user = await newUser();
      const { secret } = await enable(user);
      vi.setSystemTime(T0 + STEP);
      const valid = codeAt(secret, Date.now());
      const res = await login(user, String((Number(valid) + 1) % 1_000_000).padStart(6, '0'));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Código de verificação inválido.');
    });

    it('um código só vale uma vez — nem o da ativação, nem um já usado no login', async () => {
      const user = await newUser();
      const { secret } = await enable(user);

      const activationCode = await login(user, codeAt(secret, T0));
      expect(activationCode.status).toBe(400);

      vi.setSystemTime(T0 + STEP);
      const code = codeAt(secret, Date.now());
      expect((await login(user, code)).status).toBe(200);
      expect((await login(user, code)).status).toBe(400);

      vi.setSystemTime(T0 + 2 * STEP);
      expect((await login(user, codeAt(secret, Date.now()))).status).toBe(200);
    });

    it('depois de usar um código, recusa o do intervalo anterior, mesmo dentro da janela', async () => {
      const user = await newUser();
      const { secret } = await enable(user);
      vi.setSystemTime(T0 + 2 * STEP);
      expect((await login(user, codeAt(secret, Date.now()))).status).toBe(200);
      // T0 + STEP ainda está na janela (±1 intervalo), mas é anterior ao último usado.
      expect((await login(user, codeAt(secret, T0 + STEP))).status).toBe(400);
    });

    it('o mesmo código enviado duas vezes ao mesmo tempo entra uma vez só', async () => {
      const user = await newUser();
      const { secret } = await enable(user);
      vi.setSystemTime(T0 + STEP);
      const code = codeAt(secret, Date.now());
      const results = await Promise.all([login(user, code), login(user, code)]);
      expect(results.map(r => r.status).sort()).toEqual([200, 400]);
    });

    it('código de recuperação entra uma vez, aceito sem hífen, em minúsculas e com espaços', async () => {
      const user = await newUser();
      const { recoveryCodes } = await enable(user);
      const typed = ` ${recoveryCodes[3].replace('-', ' ').toLowerCase()} `;

      const res = await login(user, typed);
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
      expect(res.body).toMatchObject({ recoveryCodeUsed: true, recoveryCodesRemaining: 9 });
      expect((await status(user)).body.recoveryCodesRemaining).toBe(9);

      const again = await login(user, recoveryCodes[3]);
      expect(again.status).toBe(400);
      expect((await login(user, recoveryCodes[4])).status).toBe(200);
    });

    it('o mesmo código de recuperação enviado duas vezes ao mesmo tempo entra uma vez só', async () => {
      const user = await newUser();
      const { recoveryCodes } = await enable(user);
      const results = await Promise.all([login(user, recoveryCodes[0]), login(user, recoveryCodes[0])]);
      expect(results.map(r => r.status).sort()).toEqual([200, 400]);
      expect((await status(user)).body.recoveryCodesRemaining).toBe(9);
    });

    it('código de recuperação inexistente é recusado', async () => {
      const user = await newUser();
      await enable(user);
      const res = await login(user, 'AAAAA-AAAAA');
      expect(res.status).toBe(400);
      expect((await status(user)).body.recoveryCodesRemaining).toBe(10);
    });
  });

  describe('servidor sem a chave de cifragem', () => {
    it('sem TWO_FACTOR_ENCRYPTION_KEY: indisponível para ativar (503)', async () => {
      const user = await newUser();
      delete process.env.TWO_FACTOR_ENCRYPTION_KEY;
      expect((await status(user)).body.available).toBe(false);
      const res = await request(app).post('/api/auth/2fa/setup').set('Authorization', `Bearer ${user.token}`).send({});
      expect(res.status).toBe(503);
      expect(await prisma.userTwoFactor.findUnique({ where: { userId: user.id } })).toBeNull();
    });

    it('chave curta demais vale como ausente, com aviso no log', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const user = await newUser();
      process.env.TWO_FACTOR_ENCRYPTION_KEY = 'curta';
      expect((await status(user)).body.available).toBe(false);
      expect(warn).toHaveBeenCalled();
    });

    it('chave perdida depois de ativar: o login continua exigindo o segundo fator, e só a recuperação entra', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const user = await newUser();
      const { secret, recoveryCodes } = await enable(user);
      vi.setSystemTime(T0 + STEP);

      for (const lostKey of [undefined, 'outra_chave_' + 'z'.repeat(40)]) {
        if (lostKey === undefined) delete process.env.TWO_FACTOR_ENCRYPTION_KEY;
        else process.env.TWO_FACTOR_ENCRYPTION_KEY = lostKey;

        expect((await login(user)).body).toEqual({ twoFactorRequired: true });
        const totp = await login(user, codeAt(secret, Date.now()));
        expect(totp.status).toBe(400);
        expect(totp.body.error).toMatch(/código de recuperação/i);
      }
      expect(error).toHaveBeenCalled();

      const recovered = await login(user, recoveryCodes[0]);
      expect(recovered.status).toBe(200);
      expect(recovered.body.token).toBeTruthy();
    });
  });

  describe('POST /api/auth/2fa/disable', () => {
    it('senha errada, código ausente ou errado: recusa e a verificação continua ativa', async () => {
      const user = await newUser();
      const { secret } = await enable(user);
      vi.setSystemTime(T0 + STEP);
      const valid = codeAt(secret, Date.now());
      const attempts = [
        { password: 'senha-errada', code: valid },
        { password: user.password },
        { password: user.password, code: '   ' },
        { password: user.password, code: String((Number(valid) + 1) % 1_000_000).padStart(6, '0') },
      ];
      for (const body of attempts) {
        const res = await request(app).post('/api/auth/2fa/disable').set('Authorization', `Bearer ${user.token}`).send(body);
        expect(res.status).toBe(400);
      }
      expect((await status(user)).body.enabled).toBe(true);
    });

    it('com senha e código do aplicativo, desativa e o login volta a ser só com senha', async () => {
      const user = await newUser();
      const { secret } = await enable(user);
      vi.setSystemTime(T0 + STEP);
      const res = await request(app).post('/api/auth/2fa/disable').set('Authorization', `Bearer ${user.token}`)
        .send({ password: user.password, code: codeAt(secret, Date.now()) });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ enabled: false });
      expect(await prisma.userTwoFactor.findUnique({ where: { userId: user.id } })).toBeNull();

      const plain = await login(user);
      expect(plain.status).toBe(200);
      expect(plain.body.token).toBeTruthy();
    });

    it('com um código de recuperação também desativa', async () => {
      const user = await newUser();
      const { recoveryCodes } = await enable(user);
      const res = await request(app).post('/api/auth/2fa/disable').set('Authorization', `Bearer ${user.token}`)
        .send({ password: user.password, code: recoveryCodes[9] });
      expect(res.status).toBe(200);
      expect((await status(user)).body.enabled).toBe(false);
    });

    it('sem a verificação ativa, responde 409', async () => {
      const user = await newUser();
      const res = await request(app).post('/api/auth/2fa/disable').set('Authorization', `Bearer ${user.token}`)
        .send({ password: user.password, code: '123456' });
      expect(res.status).toBe(409);
    });
  });

  it('isolamento: a ativação de um usuário não afeta o outro', async () => {
    const owner = await newUser();
    const other = await newUser();
    await enable(owner);
    expect((await status(other)).body.enabled).toBe(false);
    const res = await login(other);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  describe('cifragem do segredo', () => {
    it('só decifra com a mesma chave e o mesmo usuário; valor adulterado ou malformado vira null', async () => {
      const { twoFactorKeyForTests, otherKey } = await keyHelpers();
      const payload = encryptTwoFactorSecret('JBSWY3DPEHPK3PXP', 'user-1', twoFactorKeyForTests);
      expect(decryptTwoFactorSecret(payload, 'user-1', twoFactorKeyForTests)).toBe('JBSWY3DPEHPK3PXP');
      expect(encryptTwoFactorSecret('JBSWY3DPEHPK3PXP', 'user-1', twoFactorKeyForTests)).not.toBe(payload);

      expect(decryptTwoFactorSecret(payload, 'user-2', twoFactorKeyForTests)).toBeNull();
      expect(decryptTwoFactorSecret(payload, 'user-1', otherKey)).toBeNull();
      expect(decryptTwoFactorSecret(payload, 'user-1', null)).toBeNull();

      const [version, iv, tag, data] = payload.split('.');
      const flipped = Buffer.from(data, 'base64url');
      flipped[0] ^= 1;
      expect(decryptTwoFactorSecret([version, iv, tag, flipped.toString('base64url')].join('.'), 'user-1', twoFactorKeyForTests)).toBeNull();
      const shortTag = Buffer.from(tag, 'base64url').subarray(0, 4).toString('base64url');
      expect(decryptTwoFactorSecret([version, iv, shortTag, data].join('.'), 'user-1', twoFactorKeyForTests)).toBeNull();
      for (const malformed of ['', 'abc', `v2.${iv}.${tag}.${data}`, `${payload}.extra`, 42, null]) {
        expect(decryptTwoFactorSecret(malformed, 'user-1', twoFactorKeyForTests)).toBeNull();
      }
    });
  });
});

/** A mesma derivação de chave do servidor (HKDF), para conferir o que foi gravado no banco. */
async function keyHelpers() {
  const crypto = await import('crypto');
  const derive = raw => Buffer.from(crypto.hkdfSync('sha256', raw, '', 'finflow-2fa-secret', 32));
  return { twoFactorKeyForTests: derive(TEST_TWO_FACTOR_KEY), otherKey: derive('outra_chave_' + 'z'.repeat(40)) };
}
