import { describe, it, expect } from 'vitest';
import { recoveryNotice, twoFactorSetupFromUri } from './twoFactor';

describe('twoFactorSetupFromUri (FIN-078/FIN-121)', () => {
  const URI = 'otpauth://totp/FinFlow:fulano%40teste.com?secret=JBSWY3DPEHPK3PXP&issuer=FinFlow&digits=6&period=30';

  it('tira a chave da URI e gera o QR code como imagem embutida', () => {
    const setup = twoFactorSetupFromUri(URI);
    expect(setup?.secret).toBe('JBSWY3DPEHPK3PXP');
    expect(setup?.qrCode).toMatch(/^data:image\//);
  });

  it('recusa o que não for uma URI otpauth com segredo', () => {
    for (const uri of ['', 'nao é uma url', 'https://exemplo.com/?secret=ABC', 'otpauth://totp/FinFlow:x?issuer=FinFlow']) {
      expect(twoFactorSetupFromUri(uri)).toBeNull();
    }
  });
});

describe('recoveryNotice (FIN-078)', () => {
  it('avisa que o código deixou de valer e, quando se sabe, quantos restam', () => {
    expect(recoveryNotice(null)).toMatch(/^Você entrou com um código de recuperação, que agora não vale mais\. Se perdeu/);
    expect(recoveryNotice(0)).toContain('Não resta nenhum código.');
    expect(recoveryNotice(1)).toContain('Resta 1 código.');
    expect(recoveryNotice(4)).toContain('Restam 4 códigos.');
  });
});
