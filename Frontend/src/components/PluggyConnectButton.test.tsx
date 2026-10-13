// @vitest-environment jsdom
// FIN-107 — Open Finance na barra lateral: sincronização automática ao abrir, hora da última
// sincronização de cada conexão e sincronização pelo botão de cada uma.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PluggyConnectButton } from './PluggyConnectButton';
import { apiFetch, ApiError } from '../services/api';

vi.mock('../services/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000 - 60_000).toISOString();
const ITAU = { pluggyId: 'item-1', providerName: 'Itaú', status: 'UPDATED', lastSyncAt: hoursAgo(3) };
const call = (endpoint: string, body?: unknown) => [endpoint, { method: 'POST', body, token: 'tk' }];

beforeEach(() => apiFetchMock.mockReset());
afterEach(() => {
  vi.restoreAllMocks();
  delete window.PluggyConnect;
});

describe('PluggyConnectButton (FIN-107)', () => {
  it('ao abrir, pede a sincronização automática, mostra cada conexão com a hora e recarrega o App se algo entrou', async () => {
    apiFetchMock.mockResolvedValueOnce({ synced: 1, items: [ITAU, { ...ITAU, pluggyId: 'item-2', providerName: 'Nubank', status: 'LOGIN_ERROR' }] });
    const onSyncComplete = vi.fn();
    render(<PluggyConnectButton token="tk" onSyncComplete={onSyncComplete} />);

    expect(screen.getByRole('status')).toHaveTextContent('Atualizando os dados do banco');
    expect(await screen.findByText('Última sincronização: há 3 h')).toBeInTheDocument();
    expect(screen.getByText('Login expirado: reconecte o banco')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(apiFetchMock.mock.calls).toEqual([call('/api/pluggy/auto-sync')]);
    expect(onSyncComplete).toHaveBeenCalledOnce();
  });

  it('sem nada novo, não recarrega o App', async () => {
    apiFetchMock.mockResolvedValueOnce({ synced: 0, items: [ITAU] });
    const onSyncComplete = vi.fn();
    render(<PluggyConnectButton token="tk" onSyncComplete={onSyncComplete} />);

    expect(await screen.findByText('Itaú')).toBeInTheDocument();
    expect(onSyncComplete).not.toHaveBeenCalled();
  });

  it('falha na sincronização automática vai para o console, e o painel continua podendo conectar', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('sem conexão'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSyncComplete = vi.fn();
    render(<PluggyConnectButton token="tk" onSyncComplete={onSyncComplete} />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(consoleError).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Conectar Banco' })).toBeEnabled();
    expect(onSyncComplete).not.toHaveBeenCalled();
  });

  it('pelo botão da conexão: chama a rota dela, recarrega o App e mostra "agora"; 409 avisa para reconectar', async () => {
    apiFetchMock
      .mockResolvedValueOnce({ synced: 0, items: [ITAU] })
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new ApiError('A conexão com este banco expirou.', 409, {}));
    const onSyncComplete = vi.fn();
    render(<PluggyConnectButton token="tk" onSyncComplete={onSyncComplete} />);

    const button = await screen.findByRole('button', { name: 'Sincronizar Itaú' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(await screen.findByText('Última sincronização: agora')).toBeInTheDocument();
    expect(apiFetchMock).toHaveBeenLastCalledWith(...call('/api/pluggy/sync/item-1'));
    expect(onSyncComplete).toHaveBeenCalledOnce();

    fireEvent.click(button);
    expect(await screen.findByText('A conexão com este banco expirou.')).toBeInTheDocument();
    expect(onSyncComplete).toHaveBeenCalledOnce();
  });

  it('conectar um banco registra a conexão e já a sincroniza', async () => {
    apiFetchMock
      .mockResolvedValueOnce({ synced: 0, items: [] })
      .mockResolvedValueOnce({ accessToken: 'connect-token' })
      .mockResolvedValueOnce({ success: true, providerName: 'Itaú', statusMessage: null })
      .mockResolvedValueOnce({ synced: 1, items: [{ ...ITAU, lastSyncAt: new Date().toISOString() }] });
    // Widget de mentira: conclui a conexão assim que abre.
    window.PluggyConnect = class {
      config: { onSuccess: (data: { item: { id: string } }) => void | Promise<void> };
      constructor(config: { onSuccess: (data: { item: { id: string } }) => void | Promise<void> }) {
        this.config = config;
      }
      init() {
        void this.config.onSuccess({ item: { id: 'item-1' } });
      }
    } as unknown as typeof window.PluggyConnect;
    const onSyncComplete = vi.fn();
    render(<PluggyConnectButton token="tk" onSyncComplete={onSyncComplete} />);

    const connect = screen.getByRole('button', { name: 'Conectar Banco' });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    fireEvent.click(connect);

    expect(await screen.findByText('Última sincronização: agora')).toBeInTheDocument();
    expect(apiFetchMock).toHaveBeenCalledWith(...call('/api/pluggy/connect-item', { itemId: 'item-1' }));
    expect(apiFetchMock).toHaveBeenLastCalledWith(...call('/api/pluggy/auto-sync'));
    expect(onSyncComplete).toHaveBeenCalledOnce();
  });
});
