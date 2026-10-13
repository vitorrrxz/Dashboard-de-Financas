import { describe, it, expect } from 'vitest';
import { parseRecoveryCodes, parseTwoFactorSetup, parseTwoFactorStatus } from './twoFactor';

describe('parseTwoFactorStatus (FIN-078)', () => {
  it('exige os dois booleanos e descarta campos opcionais com tipo errado', () => {
    for (const body of [null, undefined, 'texto', [], { enabled: true }, { available: 'sim', enabled: false }]) {
      expect(parseTwoFactorStatus(body)).toBeNull();
    }
    expect(parseTwoFactorStatus({ available: true, enabled: true, enabledAt: 5, recoveryCodesRemaining: '3' }))
      .toEqual({ available: true, enabled: true, enabledAt: null, recoveryCodesRemaining: null });
    expect(parseTwoFactorStatus({ available: false, enabled: true, enabledAt: '2026-09-11T12:00:00Z', recoveryCodesRemaining: 0 }))
      .toEqual({ available: false, enabled: true, enabledAt: '2026-09-11T12:00:00Z', recoveryCodesRemaining: 0 });
  });
});

describe('parseTwoFactorSetup (FIN-078)', () => {
  const setup = { secret: 'ABC', otpauthUrl: 'otpauth://totp/x', qrCode: 'data:image/gif;base64,AAAA' };

  it('aceita a resposta completa com QR code embutido', () => {
    expect(parseTwoFactorSetup({ ...setup, extra: 1 })).toEqual(setup);
  });

  it('recusa QR code que não seja imagem embutida e campos ausentes', () => {
    for (const qrCode of ['https://exemplo.com/qr.png', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 42]) {
      expect(parseTwoFactorSetup({ ...setup, qrCode })).toBeNull();
    }
    expect(parseTwoFactorSetup({ ...setup, secret: undefined })).toBeNull();
    expect(parseTwoFactorSetup({ ...setup, otpauthUrl: null })).toBeNull();
    expect(parseTwoFactorSetup([setup])).toBeNull();
  });
});

describe('parseRecoveryCodes (FIN-078)', () => {
  it('só aceita uma lista não vazia de textos', () => {
    expect(parseRecoveryCodes({ recoveryCodes: ['AAAAA-BBBBB', 'CCCCC-DDDDD'] })).toEqual(['AAAAA-BBBBB', 'CCCCC-DDDDD']);
    for (const body of [null, {}, { recoveryCodes: [] }, { recoveryCodes: 'AAAAA-BBBBB' }, { recoveryCodes: ['AAAAA-BBBBB', 7] }]) {
      expect(parseRecoveryCodes(body)).toBeNull();
    }
  });
});
