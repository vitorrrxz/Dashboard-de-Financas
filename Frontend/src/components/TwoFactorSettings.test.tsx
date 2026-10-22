// @vitest-environment jsdom
// FIN-078/FIN-121 — tela de ativação/desativação da verificação em duas etapas (Better Auth).
// FIN-123 — verificação obrigatória (sem "Desativar"; QR code de novo para outro celular) e conta sem senha.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TwoFactorSettings } from './TwoFactorSettings';
import {
  confirmTwoFactorSetup, disableTwoFactor, getTwoFactorPolicy, getTwoFactorUri, hasPassword, isTwoFactorEnabled,
  startTwoFactorSetup,
} from '../services/auth';

vi.mock('../services/auth', () => ({
  isTwoFactorEnabled: vi.fn(),
  startTwoFactorSetup: vi.fn(),
  confirmTwoFactorSetup: vi.fn(),
  disableTwoFactor: vi.fn(),
  getTwoFactorPolicy: vi.fn(),
  hasPassword: vi.fn(),
  getTwoFactorUri: vi.fn(),
}));

const policyMock = vi.mocked(getTwoFactorPolicy);
const hasPasswordMock = vi.mocked(hasPassword);
const uriMock = vi.mocked(getTwoFactorUri);

const enabledMock = vi.mocked(isTwoFactorEnabled);
const startMock = vi.mocked(startTwoFactorSetup);
const confirmMock = vi.mocked(confirmTwoFactorSetup);
const disableMock = vi.mocked(disableTwoFactor);

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const TOTP_URI = `otpauth://totp/FinFlow:fulano%40teste.com?secret=${SECRET}&issuer=FinFlow`;
const CODES = Array.from({ length: 10 }, (_, i) => `ABCD${'23456789AB'[i]}-EFGH${'23456789AB'[i]}`);

/** Abre a ativação e passa pela senha, até o QR code. */
async function reachSetup() {
  fireEvent.click(await screen.findByRole('button', { name: 'Ativar verificação em duas etapas' }));
  fireEvent.change(screen.getByLabelText('Sua senha'), { target: { value: 'senha123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Gerar QR code' }));
  return screen.findByRole('img', { name: /QR code/ });
}

describe('TwoFactorSettings', () => {
  beforeEach(() => {
    for (const mock of [enabledMock, startMock, confirmMock, disableMock, uriMock]) mock.mockReset();
    policyMock.mockReset().mockResolvedValue({ required: false });
    hasPasswordMock.mockReset().mockResolvedValue(true);
  });

  it('ativa: a senha gera o QR code, o código confirma e os códigos de recuperação aparecem uma vez', async () => {
    enabledMock.mockResolvedValue(false);
    startMock.mockResolvedValueOnce({ totpURI: TOTP_URI, backupCodes: CODES });
    confirmMock.mockResolvedValueOnce();
    render(<TwoFactorSettings />);

    const qr = await reachSetup();
    expect(startMock).toHaveBeenCalledWith('senha123');
    expect(qr.getAttribute('src')).toMatch(/^data:image\//);
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    // Os códigos só aparecem depois da confirmação.
    expect(screen.queryByRole('list', { name: 'Códigos de recuperação' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Código do aplicativo'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ativar' }));

    const list = await screen.findByRole('list', { name: 'Códigos de recuperação' });
    expect(within(list).getAllByRole('listitem').map(li => li.textContent)).toEqual(CODES);
    expect(confirmMock).toHaveBeenCalledWith('123456');

    fireEvent.click(screen.getByRole('button', { name: 'Já guardei os códigos' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Verificação em duas etapas ativada.');
    expect(screen.queryByRole('list', { name: 'Códigos de recuperação' })).not.toBeInTheDocument();
    expect(screen.getByText('Ativa')).toBeInTheDocument();
  });

  it('senha errada no início: mostra o erro e não gera o QR code', async () => {
    enabledMock.mockResolvedValue(false);
    startMock.mockRejectedValueOnce(new Error('Senha incorreta.'));
    render(<TwoFactorSettings />);

    fireEvent.click(await screen.findByRole('button', { name: 'Ativar verificação em duas etapas' }));
    fireEvent.change(screen.getByLabelText('Sua senha'), { target: { value: 'errada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gerar QR code' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Senha incorreta.');
    expect(screen.getByLabelText('Sua senha')).toHaveValue('');
    expect(screen.queryByRole('img', { name: /QR code/ })).not.toBeInTheDocument();
  });

  it('código recusado na confirmação: mostra o erro, limpa o campo e continua no QR code', async () => {
    enabledMock.mockResolvedValue(false);
    startMock.mockResolvedValueOnce({ totpURI: TOTP_URI, backupCodes: CODES });
    confirmMock.mockRejectedValueOnce(new Error('Código de verificação inválido.'));
    render(<TwoFactorSettings />);

    await reachSetup();
    fireEvent.change(screen.getByLabelText('Código do aplicativo'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ativar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Código de verificação inválido.');
    expect(screen.getByLabelText('Código do aplicativo')).toHaveValue('');
    expect(screen.getByRole('img', { name: /QR code/ })).toBeInTheDocument();
  });

  it('cancelar a configuração volta ao início sem ativar', async () => {
    enabledMock.mockResolvedValue(false);
    startMock.mockResolvedValueOnce({ totpURI: TOTP_URI, backupCodes: CODES });
    render(<TwoFactorSettings />);

    await reachSetup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('button', { name: 'Ativar verificação em duas etapas' })).toBeInTheDocument();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('desativa com a senha', async () => {
    enabledMock.mockResolvedValue(true);
    disableMock.mockResolvedValueOnce();
    render(<TwoFactorSettings />);

    expect(await screen.findByText('Ativa')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Desativar' }));
    fireEvent.change(screen.getByLabelText('Sua senha'), { target: { value: 'senha123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar desativação' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Verificação em duas etapas desativada.');
    expect(disableMock).toHaveBeenCalledWith('senha123');
    expect(screen.getByRole('button', { name: 'Ativar verificação em duas etapas' })).toBeInTheDocument();
  });

  it('desativação recusada: mostra o erro e continua ativa', async () => {
    enabledMock.mockResolvedValue(true);
    disableMock.mockRejectedValueOnce(new Error('Senha incorreta.'));
    render(<TwoFactorSettings />);

    fireEvent.click(await screen.findByRole('button', { name: 'Desativar' }));
    fireEvent.change(screen.getByLabelText('Sua senha'), { target: { value: 'errada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar desativação' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Senha incorreta.');
    expect(screen.getByText('Ativa')).toBeInTheDocument();
  });

  it('falha ao carregar o estado: mostra o erro e tenta de novo', async () => {
    enabledMock.mockRejectedValueOnce(new Error('Erro na API')).mockResolvedValueOnce(false);
    render(<TwoFactorSettings />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Erro na API');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ativar verificação em duas etapas' })).toBeInTheDocument());
  });

  describe('obrigatória (FIN-123)', () => {
    beforeEach(() => {
      policyMock.mockResolvedValue({ required: true });
    });

    it('ativa: não há como desativar, só configurar em outro celular com a senha', async () => {
      enabledMock.mockResolvedValue(true);
      uriMock.mockResolvedValueOnce(TOTP_URI);
      render(<TwoFactorSettings />);

      fireEvent.click(await screen.findByRole('button', { name: 'Configurar em outro celular' }));
      expect(screen.queryByRole('button', { name: 'Desativar' })).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Sua senha'), { target: { value: 'senha123' } });
      fireEvent.click(screen.getByRole('button', { name: 'Mostrar QR code' }));

      expect(await screen.findByRole('img', { name: /QR code/ })).toBeInTheDocument();
      expect(uriMock).toHaveBeenCalledWith('senha123');
      expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Pronto' }));
      expect(screen.queryByRole('img', { name: /QR code/ })).not.toBeInTheDocument();
    });

    it('avisa que é obrigatória e chama onEnabled só depois dos códigos guardados', async () => {
      enabledMock.mockResolvedValue(false);
      startMock.mockResolvedValueOnce({ totpURI: TOTP_URI, backupCodes: CODES });
      confirmMock.mockResolvedValueOnce();
      const onEnabled = vi.fn();
      render(<TwoFactorSettings onEnabled={onEnabled} />);

      await reachSetup();
      expect(screen.getByText(/Obrigatória em todas as contas/)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Código do aplicativo'), { target: { value: '123456' } });
      fireEvent.click(screen.getByRole('button', { name: 'Ativar' }));
      await screen.findByRole('list', { name: 'Códigos de recuperação' });
      expect(onEnabled).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Já guardei os códigos' }));
      expect(onEnabled).toHaveBeenCalledTimes(1);
    });

    it('conta sem senha (só Google/GitHub): ativar vai direto ao QR code', async () => {
      enabledMock.mockResolvedValue(false);
      hasPasswordMock.mockResolvedValue(false);
      startMock.mockResolvedValueOnce({ totpURI: TOTP_URI, backupCodes: CODES });
      render(<TwoFactorSettings />);

      fireEvent.click(await screen.findByRole('button', { name: 'Ativar verificação em duas etapas' }));
      expect(await screen.findByRole('img', { name: /QR code/ })).toBeInTheDocument();
      expect(startMock).toHaveBeenCalledWith(undefined);
      expect(screen.queryByLabelText('Sua senha')).not.toBeInTheDocument();
    });
  });
});
