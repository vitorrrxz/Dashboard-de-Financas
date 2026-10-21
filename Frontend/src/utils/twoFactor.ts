// FIN-078 — respostas da verificação em duas etapas, normalizadas antes de chegarem à tela (um
// corpo fora do formato esperado vira `null`, nunca uma exceção no meio da renderização), e o
// aviso mostrado depois de entrar com um código de recuperação.

/** Estado da verificação em duas etapas (`GET /api/auth/2fa`). */
export interface TwoFactorStatus {
  /** O servidor tem a chave de cifragem — sem ela não dá para ativar. */
  available: boolean;
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number | null;
}

/** Resposta de `POST /api/auth/2fa/setup`: segredo, URI `otpauth://` e QR code. */
export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
  qrCode: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function parseTwoFactorStatus(body: unknown): TwoFactorStatus | null {
  if (!isRecord(body) || typeof body.available !== 'boolean' || typeof body.enabled !== 'boolean') return null;
  return {
    available: body.available,
    enabled: body.enabled,
    enabledAt: typeof body.enabledAt === 'string' ? body.enabledAt : null,
    recoveryCodesRemaining: typeof body.recoveryCodesRemaining === 'number' ? body.recoveryCodesRemaining : null,
  };
}

export function parseTwoFactorSetup(body: unknown): TwoFactorSetup | null {
  if (!isRecord(body) || typeof body.secret !== 'string' || typeof body.otpauthUrl !== 'string') return null;
  // Só imagem embutida: o `src` do QR code nunca aponta para fora do app.
  if (typeof body.qrCode !== 'string' || !body.qrCode.startsWith('data:image/')) return null;
  return { secret: body.secret, otpauthUrl: body.otpauthUrl, qrCode: body.qrCode };
}

/** Códigos de recuperação da resposta de ativação; `null` se faltarem ou vierem com tipo errado. */
export function parseRecoveryCodes(body: unknown): string[] | null {
  if (!isRecord(body)) return null;
  const codes = body.recoveryCodes;
  return Array.isArray(codes) && codes.length > 0 && codes.every(c => typeof c === 'string') ? codes : null;
}

/** Aviso depois de entrar com um código de recuperação — ele deixou de valer. */
export function recoveryNotice(remaining: number | null): string {
  const left = remaining === null ? ''
    : remaining === 0 ? ' Não resta nenhum código.'
    : remaining === 1 ? ' Resta 1 código.'
    : ` Restam ${remaining} códigos.`;
  return `Você entrou com um código de recuperação, que agora não vale mais.${left} Se perdeu o acesso ao aplicativo autenticador, desative e ative de novo a verificação em duas etapas em Configurações para gerar códigos novos.`;
}
