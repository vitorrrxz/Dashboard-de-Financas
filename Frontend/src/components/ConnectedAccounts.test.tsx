// @vitest-environment jsdom
// FIN-122 — conectar e desconectar Google, GitHub e Microsoft na conta logada.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConnectedAccounts } from './ConnectedAccounts';
import { getSocialProviders, linkSocial, listLinkedProviders, takeOAuthError, unlinkSocial } from '../services/auth';

vi.mock('../services/auth', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/auth')>()),
  getSocialProviders: vi.fn(),
  listLinkedProviders: vi.fn(),
  linkSocial: vi.fn(),
  unlinkSocial: vi.fn(),
  takeOAuthError: vi.fn(),
}));

const providersMock = vi.mocked(getSocialProviders);
const linkedMock = vi.mocked(listLinkedProviders);
const linkMock = vi.mocked(linkSocial);
const unlinkMock = vi.mocked(unlinkSocial);
const oauthErrorMock = vi.mocked(takeOAuthError);

describe('ConnectedAccounts', () => {
  beforeEach(() => {
    for (const mock of [providersMock, linkedMock, linkMock, unlinkMock]) mock.mockReset();
    oauthErrorMock.mockReset().mockReturnValue(null);
    providersMock.mockResolvedValue(['google', 'github', 'microsoft']);
    linkedMock.mockResolvedValue([{ provider: 'github', id: 'conn-gh' }]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mostra cada provedor configurado, com o estado da conexão', async () => {
    render(<ConnectedAccounts />);
    expect(await screen.findByRole('button', { name: 'Desconectar GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conectar Google' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conectar Microsoft' })).toBeInTheDocument();
    expect(screen.getAllByText('Conectada')).toHaveLength(1);
  });

  it('sem provedor configurado no servidor, a seção não aparece', async () => {
    providersMock.mockResolvedValue([]);
    linkedMock.mockResolvedValue([]);
    const { container } = render(<ConnectedAccounts />);
    await waitFor(() => expect(providersMock).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('conectar leva ao provedor', async () => {
    linkMock.mockReturnValue(new Promise(() => {})); // a página sairia para o Google
    render(<ConnectedAccounts />);
    fireEvent.click(await screen.findByRole('button', { name: 'Conectar Google' }));
    expect(linkMock).toHaveBeenCalledWith('google');
  });

  it('desconectar pede confirmação e usa o id da conexão', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    unlinkMock.mockResolvedValueOnce();
    render(<ConnectedAccounts />);
    fireEvent.click(await screen.findByRole('button', { name: 'Desconectar GitHub' }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(unlinkMock).toHaveBeenCalledWith('conn-gh');
    expect(await screen.findByRole('status')).toHaveTextContent('GitHub desconectado.');
    expect(screen.getByRole('button', { name: 'Conectar GitHub' })).toBeInTheDocument();
  });

  it('desconectar cancelado não faz nada', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ConnectedAccounts />);
    fireEvent.click(await screen.findByRole('button', { name: 'Desconectar GitHub' }));
    expect(unlinkMock).not.toHaveBeenCalled();
  });

  it('desconexão recusada (ex.: única forma de entrar) mostra o erro e mantém conectada', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    unlinkMock.mockRejectedValueOnce(new Error('Esta é a única forma de entrar na sua conta e não pode ser desconectada.'));
    render(<ConnectedAccounts />);
    fireEvent.click(await screen.findByRole('button', { name: 'Desconectar GitHub' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('única forma de entrar');
    expect(screen.getByRole('button', { name: 'Desconectar GitHub' })).toBeInTheDocument();
  });

  it('erro na volta do provedor ao conectar aparece na seção', async () => {
    oauthErrorMock.mockReturnValue('Esta conta do provedor já está conectada a outro usuário do FinFlow.');
    render(<ConnectedAccounts />);
    expect(await screen.findByRole('alert')).toHaveTextContent('outro usuário do FinFlow');
  });
});
