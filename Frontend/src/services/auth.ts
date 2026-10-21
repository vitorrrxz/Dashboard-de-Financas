// FIN-121 — autenticação pelo Better Auth (rotas em /api/auth/* do backend). A sessão é um cookie
// httpOnly que o navegador manda sozinho: o app não guarda token nenhum (antes, um JWT no
// localStorage, legível por qualquer script da página — FIN-110). Os componentes usam só as funções
// daqui, que devolvem dados já normalizados e lançam `Error` com a mensagem em português.
import { createAuthClient } from 'better-auth/client';
import { twoFactorClient } from 'better-auth/client/plugins';
import { API_URL } from './api';

export type AuthUser = { id: string; name: string; email: string };

const authClient = createAuthClient({
  // Vazia, a API é a da própria origem da página (build na Vercel/Docker — ver api.ts).
  baseURL: API_URL || window.location.origin,
  basePath: '/api/auth',
  fetchOptions: { credentials: 'include' },
  plugins: [twoFactorClient()],
});

// Códigos de erro do Better Auth → mensagens da tela. O que não estiver aqui usa a mensagem do
// servidor (em inglês) ou o texto genérico.
const ERROR_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Credenciais inválidas',
  USER_ALREADY_EXISTS: 'Email já cadastrado.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Email já cadastrado.',
  PASSWORD_TOO_SHORT: 'A senha deve conter no mínimo 6 caracteres.',
  PASSWORD_TOO_LONG: 'A senha é longa demais.',
  INVALID_EMAIL: 'E-mail inválido.',
  INVALID_PASSWORD: 'Senha incorreta.',
  INVALID_CODE: 'Código de verificação inválido.',
  INVALID_BACKUP_CODE: 'Código de recuperação inválido.',
  INVALID_TWO_FACTOR_COOKIE: 'A verificação expirou. Volte e entre de novo com e-mail e senha.',
};

type ClientError = { code?: string; message?: string; status?: number } | null;

function toError(error: ClientError): Error {
  if (error?.status === 429) return new Error('Muitas tentativas. Tente novamente em alguns minutos.');
  const known = error?.code ? ERROR_MESSAGES[error.code] : undefined;
  return new Error(known ?? error?.message ?? 'Erro na API');
}

function toAuthUser(value: unknown): AuthUser {
  const u = (value ?? {}) as Record<string, unknown>;
  if (typeof u.id !== 'string' || typeof u.name !== 'string' || typeof u.email !== 'string') {
    throw new Error('Resposta inesperada do servidor. Tente novamente.');
  }
  return { id: u.id, name: u.name, email: u.email };
}

/** Quem está logado neste navegador, ou `null`. Lança se o servidor não responder (sem conexão). */
export async function getSessionUser(): Promise<AuthUser | null> {
  const { data, error } = await authClient.getSession();
  if (error) throw toError(error);
  return data?.user ? toAuthUser(data.user) : null;
}

/** Senha certa e conta com 2FA: `twoFactorRequired`, e a sessão só sai com o código (verifyTwoFactor). */
export async function signIn(email: string, password: string): Promise<{ user: AuthUser } | { twoFactorRequired: true }> {
  const { data, error } = await authClient.signIn.email({ email, password });
  if (error) throw toError(error);
  if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) return { twoFactorRequired: true };
  return { user: toAuthUser(data && 'user' in data ? data.user : null) };
}

export async function signUp(name: string, email: string, password: string): Promise<AuthUser> {
  const { data, error } = await authClient.signUp.email({ name, email, password });
  if (error) throw toError(error);
  return toAuthUser(data?.user);
}

/** Segundo passo do login: código do aplicativo ou um código de recuperação (vale uma vez). */
export async function verifyTwoFactor(code: string, recovery: boolean): Promise<AuthUser> {
  const { data, error } = recovery
    ? await authClient.twoFactor.verifyBackupCode({ code: code.trim() })
    : await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, '') });
  if (error) throw toError(error);
  return toAuthUser(data?.user);
}

/** Encerra a sessão no servidor — o cookie deixa de valer mesmo que alguém o tenha copiado. */
export async function signOut(): Promise<void> {
  await authClient.signOut();
}

/** A verificação em duas etapas está ativa para quem está logado. */
export async function isTwoFactorEnabled(): Promise<boolean> {
  const { data, error } = await authClient.getSession();
  if (error) throw toError(error);
  return Boolean((data?.user as { twoFactorEnabled?: boolean | null } | undefined)?.twoFactorEnabled);
}

/** Primeiro passo da ativação: com a senha, gera o segredo (URI otpauth) e os códigos de recuperação. */
export async function startTwoFactorSetup(password: string): Promise<{ totpURI: string; backupCodes: string[] }> {
  const { data, error } = await authClient.twoFactor.enable({ password });
  if (error) throw toError(error);
  // `method: 'otp'` é o 2FA por código enviado (e-mail/SMS), que o FinFlow não usa.
  if (!data || data.method !== 'totp' || typeof data.totpURI !== 'string' || !Array.isArray(data.backupCodes)) {
    throw new Error('Resposta inesperada do servidor.');
  }
  return { totpURI: data.totpURI, backupCodes: data.backupCodes };
}

/** Segundo passo da ativação: o código do aplicativo confirma e liga a verificação. */
export async function confirmTwoFactorSetup(code: string): Promise<void> {
  const { error } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, '') });
  if (error) throw toError(error);
}

export async function disableTwoFactor(password: string): Promise<void> {
  const { error } = await authClient.twoFactor.disable({ password });
  if (error) throw toError(error);
}
