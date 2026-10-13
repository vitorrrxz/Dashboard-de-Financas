import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import * as OTPAuth from 'otpauth';
import qrcode from 'qrcode-generator';
import { prisma } from '../lib/prisma.js';
import { authenticateToken, authLimiter, JWT_EXPIRES_IN, JWT_SECRET } from '../lib/auth.js';
import { sendInternalError } from '../lib/http.js';

export const router = express.Router();

router.post('/register', authLimiter, async (req, res) => {
  const { name, password } = req.body;
  // Normaliza o e-mail (trim + lowercase) antes de checar unicidade e salvar — sem isso,
  // "Usuario@Gmail.com" e "usuario@gmail.com" eram tratados como contas diferentes
  // (ver FIN-013 em docs/BACKLOG_DETAIL.md).
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : req.body.email;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Nome completo é obrigatório.' });
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'E-mail inválido.' });
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'A senha deve conter no mínimo 6 caracteres.' });
  }

  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    // Decisão registrada (ver FIN-014 em docs/BACKLOG_DETAIL.md): mantemos a mensagem
    // específica "Email já cadastrado" — é necessária para o UX de registro e o risco de
    // enumeração é baixo (não vaza dado sensível além de "existe conta"), já mitigado
    // pelo rate limit de FIN-007 acima.
    if (existingUser) return res.status(400).json({ error: 'Email já cadastrado.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, passwordHash },
    });

    const token = jwt.sign({ userId: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    sendInternalError(res, error, 'Erro ao criar usuário.');
  }
});

/* -------------------------------------------------------------------------- */
/*                 VERIFICAÇÃO EM DUAS ETAPAS — TOTP (FIN-078)                 */
/* -------------------------------------------------------------------------- */
// Códigos de 6 dígitos que mudam a cada 30 s (RFC 6238), compatíveis com Google Authenticator,
// Microsoft Authenticator, Authy, 1Password etc. Aceita também o intervalo anterior e o seguinte
// (±30 s), para tolerar o relógio do celular um pouco adiantado ou atrasado.
const TOTP_ISSUER = 'FinFlow';
const TOTP_WINDOW = 1;
const TOTP_CODE_PATTERN = /^\d{6}$/;
// Códigos de recuperação: entram no lugar do aplicativo quando o celular se perde, uma vez cada.
// Sem I, O, 0 e 1, que se confundem ao copiar à mão; 32 símbolos = 5 bits por caractere, então
// 10 caracteres = 50 bits. Guardados com bcrypt, e não sha256: com 50 bits, um hash rápido seria
// quebrável por força bruta em quem copiasse o banco.
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 10;
const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const TWO_FACTOR_UNAVAILABLE = 'A verificação em duas etapas não está configurada neste servidor.';
const TWO_FACTOR_ALREADY_ENABLED = 'A verificação em duas etapas já está ativa.';
const INVALID_SECOND_FACTOR = 'Código de verificação inválido.';

let twoFactorKeyWarned = false;

/**
 * Chave AES-256 que cifra os segredos TOTP no banco, derivada (HKDF) de
 * TWO_FACTOR_ENCRYPTION_KEY. Sem a variável — ou com menos de 32 caracteres —, a ativação fica
 * indisponível: gravar o segredo em texto puro deixaria qualquer cópia do banco gerar os códigos.
 * É uma chave própria, e não derivada do JWT_SECRET, para que trocar o JWT_SECRET (a resposta a
 * um token vazado) não invalide o 2FA de todos. Lida a cada uso, e não só no carregamento do
 * módulo, para os testes poderem simular um servidor sem a chave.
 */
function twoFactorKey() {
  const raw = process.env.TWO_FACTOR_ENCRYPTION_KEY || '';
  if (raw.length >= 32) return Buffer.from(crypto.hkdfSync('sha256', raw, '', 'finflow-2fa-secret', 32));
  if (raw && !twoFactorKeyWarned) {
    console.warn('⚠️  TWO_FACTOR_ENCRYPTION_KEY tem menos de 32 caracteres e foi ignorada — verificação em duas etapas indisponível.');
    twoFactorKeyWarned = true;
  }
  return null;
}

// Formato gravado: "v1.<iv>.<tag>.<cifrado>", em base64url. O `userId` entra como dado
// autenticado (AAD): o segredo de um usuário copiado para a linha de outro não decifra. A tag
// tem tamanho fixo de 16 bytes na decifragem — sem isso o Node aceitaria tags truncadas.
export function encryptTwoFactorSecret(plain, userId, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(userId, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

/** Decifra o segredo TOTP; `null` quando a chave falta, mudou, ou o valor foi adulterado. */
export function decryptTwoFactorSecret(payload, userId, key) {
  if (!key || typeof payload !== 'string') return null;
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const [, iv, tag, data] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), { authTagLength: 16 });
    decipher.setAAD(Buffer.from(userId, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Gerador TOTP do segredo (base32). O `label` só aparece no QR code — não afeta a validação. */
function buildTotp(secretBase32, label = '') {
  return new OTPAuth.TOTP({ issuer: TOTP_ISSUER, label, secret: OTPAuth.Secret.fromBase32(secretBase32) });
}

/** QR code do `otpauth://` como imagem (data URL), para o aplicativo autenticador ler. */
function qrCodeDataUrl(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(4, 4);
}

function generateRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    let code = '';
    for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) {
      code += RECOVERY_CODE_ALPHABET[crypto.randomInt(RECOVERY_CODE_ALPHABET.length)];
    }
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

/** Forma canônica do código de recuperação: maiúsculas, sem espaços nem hífens. */
function normalizeRecoveryCode(input) {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

/** Hashes dos códigos de recuperação restantes; um valor corrompido vale como lista vazia. */
function parseRecoveryHashes(stored) {
  try {
    const list = JSON.parse(stored);
    return Array.isArray(list) ? list.filter(hash => typeof hash === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Confere o segundo fator de um `UserTwoFactor` ativo — código de 6 dígitos do aplicativo ou
 * código de recuperação — e consome o que foi usado: o intervalo TOTP passa a ser o
 * `lastUsedStep`, e o código de recuperação sai da lista. O consumo é um `updateMany`
 * condicionado ao valor que acabou de ser lido, então duas requisições simultâneas com o mesmo
 * código não passam as duas. Devolve `{ ok: true, method, remaining? }` ou `{ ok: false, reason }`.
 */
async function consumeSecondFactor(record, rawCode) {
  const code = typeof rawCode === 'string' ? rawCode.replace(/\s/g, '') : '';

  if (TOTP_CODE_PATTERN.test(code)) {
    const secret = decryptTwoFactorSecret(record.secret, record.userId, twoFactorKey());
    if (!secret) {
      console.error(`2FA: o segredo do usuário ${record.userId} não pôde ser decifrado (TWO_FACTOR_ENCRYPTION_KEY ausente ou trocada).`);
      return { ok: false, reason: 'undecryptable' };
    }
    const totp = buildTotp(secret);
    const timestamp = Date.now();
    const delta = totp.validate({ token: code, timestamp, window: TOTP_WINDOW });
    if (delta === null) return { ok: false, reason: 'invalid' };
    const step = totp.counter({ timestamp }) + delta;
    const result = await prisma.userTwoFactor.updateMany({
      where: { userId: record.userId, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] },
      data: { lastUsedStep: step },
    });
    return result.count === 1 ? { ok: true, method: 'totp' } : { ok: false, reason: 'invalid' };
  }

  const normalized = normalizeRecoveryCode(code);
  if (normalized.length !== RECOVERY_CODE_LENGTH) return { ok: false, reason: 'invalid' };
  const hashes = parseRecoveryHashes(record.recoveryCodes);
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(normalized, hashes[i])) {
      const remaining = hashes.filter((_, j) => j !== i);
      const result = await prisma.userTwoFactor.updateMany({
        where: { userId: record.userId, recoveryCodes: record.recoveryCodes },
        data: { recoveryCodes: JSON.stringify(remaining) },
      });
      return result.count === 1
        ? { ok: true, method: 'recovery', remaining: remaining.length }
        : { ok: false, reason: 'invalid' };
    }
  }
  return { ok: false, reason: 'invalid' };
}

/** Mensagem de um segundo fator recusado. Sem a chave, só os códigos de recuperação funcionam. */
function secondFactorError(reason) {
  return reason === 'undecryptable'
    ? 'Não foi possível validar o código do aplicativo neste servidor. Use um código de recuperação.'
    : INVALID_SECOND_FACTOR;
}

router.post('/login', authLimiter, async (req, res) => {
  const { password } = req.body;
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : req.body.email;

  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'E-mail é obrigatório.' });
  }
  if (!password || typeof password !== 'string' || !password.trim()) {
    return res.status(400).json({ error: 'Senha é obrigatória.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email }, include: { twoFactor: true } });
    if (!user) return res.status(400).json({ error: 'Credenciais inválidas' });

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) return res.status(400).json({ error: 'Credenciais inválidas' });

    // FIN-078 — com a verificação em duas etapas ativa, a senha certa não basta. Sem código, a
    // resposta pede o segundo fator (sem token); com código, ele precisa conferir. Só chega
    // aqui quem acertou a senha: a senha errada recebe a mesma mensagem de sempre, e nada
    // revela se a conta usa 2FA. Uma configuração iniciada e não confirmada não conta.
    let recoveryInfo = {};
    if (user.twoFactor?.enabledAt) {
      const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
      if (!code) return res.json({ twoFactorRequired: true });
      const check = await consumeSecondFactor(user.twoFactor, code);
      if (!check.ok) return res.status(400).json({ error: secondFactorError(check.reason) });
      if (check.method === 'recovery') {
        recoveryInfo = { recoveryCodeUsed: true, recoveryCodesRemaining: check.remaining };
      }
    }

    const token = jwt.sign({ userId: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email }, ...recoveryInfo });
  } catch (error) {
    sendInternalError(res, error, 'Erro ao realizar login.');
  }
});

router.get('/me', authenticateToken, async (req, res) => {
  res.json({ user: req.user });
});

// FIN-078 — estado da verificação em duas etapas do usuário: se o servidor tem a chave para
// ativá-la (`available`), se está ativa e quantos códigos de recuperação restam.
router.get('/2fa', authenticateToken, async (req, res) => {
  try {
    const record = await prisma.userTwoFactor.findUnique({ where: { userId: req.user.userId } });
    const enabled = Boolean(record?.enabledAt);
    res.json({
      available: twoFactorKey() !== null,
      enabled,
      enabledAt: enabled ? record.enabledAt : null,
      recoveryCodesRemaining: enabled ? parseRecoveryHashes(record.recoveryCodes).length : null,
    });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao consultar a verificação em duas etapas.');
  }
});

// Passo 1 da ativação: gera um segredo novo e devolve o QR code. Nada muda no login ainda —
// o registro nasce com `enabledAt` nulo e só vale depois de confirmado (passo 2).
router.post('/2fa/setup', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const key = twoFactorKey();
  if (!key) return res.status(503).json({ error: TWO_FACTOR_UNAVAILABLE });
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    const data = { secret: encryptTwoFactorSecret(secret, userId, key), enabledAt: null, lastUsedStep: null, recoveryCodes: '[]' };
    // Recomeçar uma configuração pendente troca o segredo; uma já ativa, nunca. O
    // `enabledAt: null` no filtro vale também contra uma ativação feita em outra aba entre a
    // leitura e a escrita: sem registro pendente, cai no `create`, que esbarra no registro ativo.
    const updated = await prisma.userTwoFactor.updateMany({ where: { userId, enabledAt: null }, data });
    if (updated.count === 0) {
      try {
        await prisma.userTwoFactor.create({ data: { userId, ...data } });
      } catch (err) {
        if (err.code === 'P2002') return res.status(409).json({ error: TWO_FACTOR_ALREADY_ENABLED });
        throw err;
      }
    }

    const otpauthUrl = buildTotp(secret, user.email).toString();
    res.json({ secret, otpauthUrl, qrCode: qrCodeDataUrl(otpauthUrl) });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao iniciar a verificação em duas etapas.');
  }
});

// Passo 2: confirma com a senha e um código do aplicativo, e devolve os códigos de recuperação
// — a única vez em que aparecem em texto. A senha é exigida para que um token vazado não baste
// para ativar o 2FA com o celular de outra pessoa e trancar o dono fora da conta.
router.post('/2fa/enable', authLimiter, authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { password } = req.body;
  const code = typeof req.body.code === 'string' ? req.body.code.replace(/\s/g, '') : '';
  if (typeof password !== 'string' || !password) return res.status(400).json({ error: 'Senha é obrigatória.' });
  if (!TOTP_CODE_PATTERN.test(code)) return res.status(400).json({ error: 'Informe o código de 6 dígitos do aplicativo.' });
  const key = twoFactorKey();
  if (!key) return res.status(503).json({ error: TWO_FACTOR_UNAVAILABLE });

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { twoFactor: true } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (!(await bcrypt.compare(password, user.passwordHash))) return res.status(400).json({ error: 'Senha incorreta.' });

    const record = user.twoFactor;
    if (record?.enabledAt) return res.status(409).json({ error: TWO_FACTOR_ALREADY_ENABLED });
    if (!record) return res.status(400).json({ error: 'Gere o QR code antes de confirmar.' });
    const secret = decryptTwoFactorSecret(record.secret, userId, key);
    if (!secret) return res.status(400).json({ error: 'Esta configuração não vale mais. Gere um novo QR code.' });

    const totp = buildTotp(secret);
    const timestamp = Date.now();
    const delta = totp.validate({ token: code, timestamp, window: TOTP_WINDOW });
    if (delta === null) return res.status(400).json({ error: INVALID_SECOND_FACTOR });

    const recoveryCodes = generateRecoveryCodes();
    const hashes = await Promise.all(recoveryCodes.map(c => bcrypt.hash(normalizeRecoveryCode(c), 10)));
    // `secret` no filtro: se outra aba gerou um QR code novo depois da leitura, o código
    // conferido é de um segredo que já não vale, e a ativação não acontece.
    const result = await prisma.userTwoFactor.updateMany({
      where: { userId, enabledAt: null, secret: record.secret },
      data: { enabledAt: new Date(), lastUsedStep: totp.counter({ timestamp }) + delta, recoveryCodes: JSON.stringify(hashes) },
    });
    if (result.count === 0) return res.status(409).json({ error: 'A configuração mudou em outra janela. Gere um novo QR code.' });
    res.json({ enabled: true, recoveryCodes });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao ativar a verificação em duas etapas.');
  }
});

// Desativa com a senha e um segundo fator (código do aplicativo ou de recuperação) — quem só
// tem o token, ou só a senha, não consegue tirar a proteção.
router.post('/2fa/disable', authLimiter, authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { password, code } = req.body;
  if (typeof password !== 'string' || !password) return res.status(400).json({ error: 'Senha é obrigatória.' });
  if (typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({ error: 'Informe um código do aplicativo ou um código de recuperação.' });
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { twoFactor: true } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (!(await bcrypt.compare(password, user.passwordHash))) return res.status(400).json({ error: 'Senha incorreta.' });
    if (!user.twoFactor?.enabledAt) return res.status(409).json({ error: 'A verificação em duas etapas não está ativa.' });

    const check = await consumeSecondFactor(user.twoFactor, code);
    if (!check.ok) return res.status(400).json({ error: secondFactorError(check.reason) });
    await prisma.userTwoFactor.deleteMany({ where: { userId } });
    res.json({ enabled: false });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao desativar a verificação em duas etapas.');
  }
});
