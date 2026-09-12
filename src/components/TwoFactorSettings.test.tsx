// FIN-078 — tela de ativação/desativação da verificação em duas etapas.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TwoFactorSettings } from './TwoFactorSettings';
import { parseTwoFactorStatus } from '../utils/twoFactor';
import { apiFetch, ApiError, type ApiFetchOptions } from '../services/api';

vi.mock('../services/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);

const STATUS_OFF = { available: true, enabled: false, enabledAt: null, recoveryCodesRemaining: null };
const STATUS_ON = { available: true, enabled: true, enabledAt: '2026-09-11T12:00:00.000Z', recoveryCodesRemaining: 2 };
const SETUP = {
  secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  otpauthUrl: 'otpauth://totp/FinFlow:fulano%40teste.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  qrCode: 'data:image/gif;base64,R0lGODdh',
};
const CODES = Array.from({ length: 10 }, (_, i) => `ABCD${'23456789AB'[i]}-EFGH${'23456789AB'[i]}`);

type Handler = (body: unknown) => unknown;

/** Responde por "MÉTODO rota"; uma rota não prevista falha o teste. */
function mockApi(routes: Record<string, Handler>) {
  apiFetchMock.mockImplementation((async (endpoint: string, options: ApiFetchOptions = {}) => {
    const key = `${options.method ?? 'GET'} ${endpoint}`;
    const handler = routes[key];
    if (!handler) throw new Error(`rota inesperada no teste: ${key}`);
    return handler(options.body);
  }) as typeof apiFetch);
}

describe('TwoFactorSettings', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('ativa: gera o QR code, confirma com senha e código e mostra os códigos de recuperação uma vez', async () => {
    mockApi({
      'GET /api/auth/2fa': () => STATUS_OFF,
      'POST /api/auth/2fa/setup': () => SETUP,
      'POST /api/auth/2fa/enable': () => ({ enabled: true, recoveryCodes: CODES }),
    });
    render(<TwoFactorSettings token="tok" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Ativar verificação em duas etapas' }));
    expect(await screen.findByRole('img', { name: /QR code/ })).toHaveAttribute('src', SETUP.qrCode);
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Sua senha'), { target: { value: 'senha123' } });
    fireEvent.change(screen.getByLabelText('Código do aplicativo'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ativar' }));

    const list = await screen.findByRole('list', { name: 'Códigos de recuperação' });
    expect(within(list).getAllByRole('listitem').map(li => li.textContent)).toEqual(CODES);
    expect(apiFetchMock).toHaveBeenCalledWith('/api/auth/2fa/enable', {
      method: 'POST', token: 'tok', body: { password: 'senha123', code: '123456' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Já guardei os códigos' }));
    expect(screen.queryByRole('list', { name: 'Códigos de recuperação' })).not.toBeInTheDocument();
    expect(screen.getByText('Ativa')).toBeInTheDocument();
    expect(screen.getByText('10 códigos de recuperação restantes.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Verificação em duas etapas ativada.');
  });

  it('código recusado na ativação: mostra o erro, limpa só o código e continua no QR code', async () => {
    mockApi({
      'GET /api/auth/2fa': () => STATUS_OFF,
      'POST /api/auth/2fa/setup': () => SETUP,
      'POST /api/auth/2fa/enable': () => { throw new ApiError('Código de verificação inválido.', 400, {}); },
    });
    render(<TwoFactorSettings token="tok" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ativar verificação em duas etapas' }));
    fireEvent.change(await screen.findByLabelText('Sua senha'), { target: { value: 'senha123' } });
    fireEvent.change(screen.getByLabelText('Código do aplicativo'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ativar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Código de verificação inválido.');
    expect(screen.getByLabelText('Código do aplicativo')).toHaveValue('');
    expect(screen.getByLabelText('Sua senha')).toHaveValue('senha123');
    expect(screen.getByRole('img', { name: /QR code/ })).toBeInTheDocument();
  });

  it('resposta de configuração sem QR code embutido é recusada', async () => {
    mockApi({
      'GET /api/auth/2fa': () => STATUS_OFF,
      'POST /api/auth/2fa/setup': () => ({ ...SETUP, qrCode: 'https://exemplo.com/qr.png' }),
    });
    render(<TwoFactorSettings token="tok" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ativar verificação em duas etapas' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Resposta inesperada do servidor.');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('ativa, mas sem códigos legíveis na resposta: avisa e recarrega o estado real', async () => {
    let statusCalls = 0;
    mockApi({
      'GET /api/auth/2fa': () => (++statusCalls === 1 ? STATUS_OFF : { ...STATUS_ON, recoveryCodesRemaining: 10 }),
      'POST /api/auth/2fa/setup': () => SETUP,
      'POST /api/auth/2fa/enable': () => ({ enabled: true }),
    });
    render(<TwoFactorSettings token="tok" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ativar verificação em duas etapas' }));
    fireEvent.change(await screen.findByLabelText('Sua senha'), { target: { value: 'senha123' } });
    fireEvent.change(screen.getByLabelText('Código do aplicativo'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ativar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Desative e ative de novo');
    expect(await screen.findByText('Ativa')).toBeInTheDocument();
    expect(statusCalls).toBe(2);
  });

  it('ativa: mostra desde quando, avisa quando restam poucos códigos e desativa com senha e código', async () => {
    mockApi({
      'GET /api/auth/2fa': () => STATUS_ON,
      'POST /api/auth/2fa/disable': () => ({ enabled: false }),
    });
    render(<TwoFactorSettings token="tok" />);

    expect(await screen.findByText('Ativa')).toBeInTheDocument();
    expect(screen.getByText('desde 11/09/2026')).toBeInTheDocument();
    expect(screen.getByText('2 códigos de recuperação restantes.')).toHaveClass('text-amber-300');

    fireEvent.click(screen.getByRole('button', { name: 'Desativar' }));
    fireEvent.change(screen.getByLabelText('Sua senha'), { target: { value: 'senha123' } });
    fireEvent.change(screen.getByLabelText('Código do aplicativo ou de recuperação'), { target: { value: 'ABCDE-FGHJK' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar desativação' }));

    expect(await screen.findByRole('button', { name: 'Ativar verificação em duas etapas' })).toBeInTheDocument();
    expect(apiFetchMock).toHaveBeenCalledWith('/api/auth/2fa/disable', {
      method: 'POST', token: 'tok', body: { password: 'senha123', code: 'ABCDE-FGHJK' },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Verificação em duas etapas desativada.');
  });

  it('desativação recusada: mostra o erro e a verificação continua ativa', async () => {
    mockApi({
      'GET /api/auth/2fa': () => STATUS_ON,
      'POST /api/auth/2fa/disable': () => { throw new ApiError('Senha incorreta.', 400, {}); },
    });
    render(<TwoFactorSettings token="tok" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Desativar' }));
    fireEvent.change(screen.getByLabelText('Sua senha'), { target: { value: 'errada' } });
    fireEvent.change(screen.getByLabelText('Código do aplicativo ou de recuperação'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar desativação' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Senha incorreta.');
    expect(screen.getByText('Ativa')).toBeInTheDocument();
    expect(screen.getByLabelText('Código do aplicativo ou de recuperação')).toHaveValue('');
  });

  it('servidor sem a chave: explica o que falta e não oferece ativar', async () => {
    mockApi({ 'GET /api/auth/2fa': () => ({ ...STATUS_OFF, available: false }) });
    render(<TwoFactorSettings token="tok" />);
    expect(await screen.findByText('TWO_FACTOR_ENCRYPTION_KEY')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ativar/ })).not.toBeInTheDocument();
  });

  it('ativa com a chave indisponível no servidor: avisa que só os códigos de recuperação entram', async () => {
    mockApi({ 'GET /api/auth/2fa': () => ({ ...STATUS_ON, available: false }) });
    render(<TwoFactorSettings token="tok" />);
    expect(await screen.findByText(/só aceita os códigos de recuperação/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desativar' })).toBeInTheDocument();
  });

  it('falha ou resposta inesperada ao carregar: mostra o erro e permite tentar de novo', async () => {
    let calls = 0;
    mockApi({
      'GET /api/auth/2fa': () => {
        calls += 1;
        if (calls === 1) throw new ApiError('Erro ao consultar a verificação em duas etapas.', 500, {});
        return calls === 2 ? { enabled: 'sim' } : STATUS_OFF;
      },
    });
    render(<TwoFactorSettings token="tok" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Erro ao consultar a verificação em duas etapas.');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Resposta inesperada do servidor.'));
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('button', { name: 'Ativar verificação em duas etapas' })).toBeInTheDocument();
  });

  it('parseTwoFactorStatus: exige os booleanos e descarta campos com tipo errado', () => {
    expect(parseTwoFactorStatus(null)).toBeNull();
    expect(parseTwoFactorStatus({ enabled: true })).toBeNull();
    expect(parseTwoFactorStatus({ available: true, enabled: true, enabledAt: 5, recoveryCodesRemaining: '3' }))
      .toEqual({ available: true, enabled: true, enabledAt: null, recoveryCodesRemaining: null });
  });
});
