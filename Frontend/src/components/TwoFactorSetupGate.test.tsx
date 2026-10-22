// @vitest-environment jsdom
// FIN-123 — tela de quem entrou sem a verificação em duas etapas, com ela obrigatória.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TwoFactorSetupGate } from './TwoFactorSetupGate';
import { getTwoFactorPolicy, hasPassword, isTwoFactorEnabled } from '../services/auth';

vi.mock('../services/auth', () => ({
  isTwoFactorEnabled: vi.fn(),
  getTwoFactorPolicy: vi.fn(),
  hasPassword: vi.fn(),
  startTwoFactorSetup: vi.fn(),
  confirmTwoFactorSetup: vi.fn(),
  disableTwoFactor: vi.fn(),
  getTwoFactorUri: vi.fn(),
}));

describe('TwoFactorSetupGate', () => {
  beforeEach(() => {
    vi.mocked(isTwoFactorEnabled).mockResolvedValue(false);
    vi.mocked(getTwoFactorPolicy).mockResolvedValue({ required: true });
    vi.mocked(hasPassword).mockResolvedValue(true);
  });

  it('explica a exigência e já oferece a ativação', async () => {
    render(<TwoFactorSetupGate onEnabled={() => {}} onLogout={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Proteja sua conta' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Ativar verificação em duas etapas' })).toBeInTheDocument();
  });

  it('dá para sair sem ativar', () => {
    const onLogout = vi.fn();
    render(<TwoFactorSetupGate onEnabled={() => {}} onLogout={onLogout} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(onLogout).toHaveBeenCalled();
  });
});
