// FIN-078/FIN-121 — apoio à verificação em duas etapas: o QR code e a chave para digitar, tirados da
// URI `otpauth://` que o Better Auth devolve ao iniciar a ativação, e o aviso mostrado depois de
// entrar com um código de recuperação.
import qrcode from 'qrcode-generator';

/** O que a tela mostra para configurar o aplicativo autenticador. */
export interface TwoFactorSetup {
  /** Chave em base32, para quem não pode escanear o QR code. */
  secret: string;
  /** QR code da URI, como imagem embutida (`data:image/...`) — o `src` nunca aponta para fora do app. */
  qrCode: string;
}

/** QR code e chave da URI `otpauth://totp/...`; `null` se a URI não for uma de TOTP com segredo. */
export function twoFactorSetupFromUri(totpURI: string): TwoFactorSetup | null {
  let url: URL;
  try {
    url = new URL(totpURI);
  } catch {
    return null;
  }
  const secret = url.searchParams.get('secret');
  if (url.protocol !== 'otpauth:' || !secret) return null;
  // Mesmos parâmetros do QR code que o servidor gerava antes (correção de erro M, módulos de 4 px).
  const qr = qrcode(0, 'M');
  qr.addData(totpURI);
  qr.make();
  return { secret, qrCode: qr.createDataURL(4, 4) };
}

/** Aviso depois de entrar com um código de recuperação — ele deixou de valer. */
export function recoveryNotice(remaining: number | null): string {
  const left = remaining === null ? ''
    : remaining === 0 ? ' Não resta nenhum código.'
    : remaining === 1 ? ' Resta 1 código.'
    : ` Restam ${remaining} códigos.`;
  return `Você entrou com um código de recuperação, que agora não vale mais.${left} Se perdeu o acesso ao aplicativo autenticador, desative e ative de novo a verificação em duas etapas em Configurações para gerar códigos novos.`;
}
