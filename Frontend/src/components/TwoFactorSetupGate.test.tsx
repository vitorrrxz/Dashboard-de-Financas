// @vitest-environment jsdom
// FIN-123 — tela de quem entrou sem a verificação em duas etapas, com ela obrigatória.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TwoFactorSetupGate } from './TwoFactorSetupGate';
import { getTwoFactorPolicy, hasPassword, isTwoFactorEnabled, startTwoFactorSetup } from '../services/auth';

vi.mock('../services/auth', () => ({
  isTwoFactorEnabled: vi.fn(),
  getTwoFactorPolicy: vi.fn(),
  hasPassword: vi.fn(),
  startTwoFactorSetup: vi.fn(),
  confirmTwoFactorSetup: vi.fn(),
  disableTwoFactor: vi.fn(),
  getTwoFactorUri: vi.fn(),
}));

const TOTP_URI = 'otpauth://totp/FinFlow:fulano%40teste.com?secret=JBSWY3DPEHPK3PXP&issuer=FinFlow';

describe('TwoFactorSetupGate', () => {
  beforeEach(() => {
    vi.mocked(isTwoFactorEnabled).mockResolvedValue(false);
    vi.mocked(getTwoFactorPolicy).mockResolvedValue({ required: true });
    vi.mocked(hasPassword).mockResolvedValue(true);
  });

  it('explica a exigência e já abre pedindo a senha que gera o QR code', async () => {
    vi.mocked(startTwoFactorSetup).mockResolvedValueOnce({ totpURI: TOTP_URI, backupCodes: ['ABCDE-FGHJK'] });
    render(<TwoFactorSetupGate onEnabled={() => {}} onLogout={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Proteja sua conta' })).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('Sua senha'), { target: { value: 'senha123' } });
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar QR code' }));
    expect(await screen.findByRole('img', { name: /QR code/ })).toBeInTheDocument();
    expect(startTwoFactorSetup).toHaveBeenCalledWith('senha123');
  });

  it('conta sem senha: um clique gera o QR code', async () => {
    vi.mocked(hasPassword).mockResolvedValue(false);
    vi.mocked(startTwoFactorSetup).mockResolvedValueOnce({ totpURI: TOTP_URI, backupCodes: ['ABCDE-FGHJK'] });
    render(<TwoFactorSetupGate onEnabled={() => {}} onLogout={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Gerar QR code' }));
    expect(await screen.findByRole('img', { name: /QR code/ })).toBeInTheDocument();
    expect(startTwoFactorSetup).toHaveBeenCalledWith(undefined);
    expect(screen.queryByLabelText('Sua senha')).not.toBeInTheDocument();
  });

  it('dá para sair sem ativar', () => {
    const onLogout = vi.fn();
    render(<TwoFactorSetupGate onEnabled={() => {}} onLogout={onLogout} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(onLogout).toHaveBeenCalled();
  });
});
