// FIN-030 (base de testes do frontend) e FIN-078 (segundo passo do login quando a conta tem
// verificação em duas etapas).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthForm } from './AuthForm';
import { recoveryNotice } from '../utils/twoFactor';
import { apiFetch, ApiError } from '../services/api';

vi.mock('../services/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);
const USER = { id: 'u1', name: 'Fulano', email: 'fulano@teste.com' };

function fillCredentials() {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: USER.email } });
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha123' } });
}

/** Faz o primeiro envio (e-mail e senha) com o servidor pedindo o segundo fator. */
async function reachTwoFactorStep(onLogin = vi.fn()) {
  render(<AuthForm onLogin={onLogin} />);
  fillCredentials();
  fireEvent.click(screen.getByRole('button', { name: /Entrar no Sistema/ }));
  expect(await screen.findByRole('heading', { name: 'Verificação em duas etapas' })).toBeInTheDocument();
  return onLogin;
}

describe('AuthForm', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renderiza o formulário de login por padrão, com os rótulos associados aos campos', () => {
    render(<AuthForm onLogin={() => {}} />);
    expect(screen.getByText('Bem-vindo de volta!')).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Senha')).toHaveAttribute('type', 'password');
  });

  it('alterna para o formulário de cadastro ao clicar em "Cadastre-se"', async () => {
    const { getByText } = render(<AuthForm onLogin={() => {}} />);
    getByText('Cadastre-se').click();
    expect(await screen.findByText('Crie sua conta')).toBeInTheDocument();
    expect(screen.getByLabelText('Nome Completo')).toBeInTheDocument();
  });

  it('sem verificação em duas etapas, entra direto com e-mail e senha', async () => {
    apiFetchMock.mockResolvedValueOnce({ token: 'tok', user: USER });
    const onLogin = vi.fn();
    render(<AuthForm onLogin={onLogin} />);
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: /Entrar no Sistema/ }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('tok', USER));
    expect(apiFetchMock).toHaveBeenCalledWith('/api/auth/login', {
      method: 'POST', body: { email: USER.email, password: 'senha123' },
    });
  });

  it('com a verificação ativa, pede o código e o envia junto de e-mail e senha', async () => {
    apiFetchMock
      .mockResolvedValueOnce({ twoFactorRequired: true })
      .mockResolvedValueOnce({ token: 'tok', user: USER });
    const onLogin = await reachTwoFactorStep();
    expect(onLogin).not.toHaveBeenCalled();

    const codeInput = screen.getByLabelText('Código do aplicativo');
    expect(codeInput).toHaveAttribute('autocomplete', 'one-time-code');
    expect(codeInput).toHaveAttribute('inputmode', 'numeric');
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Verificar/ }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('tok', USER));
    expect(apiFetchMock).toHaveBeenLastCalledWith('/api/auth/login', {
      method: 'POST', body: { email: USER.email, password: 'senha123', code: '123456' },
    });
  });

  it('código recusado: mostra o erro, limpa o campo e continua no passo do código', async () => {
    apiFetchMock
      .mockResolvedValueOnce({ twoFactorRequired: true })
      .mockRejectedValueOnce(new ApiError('Código de verificação inválido.', 400, {}));
    const onLogin = await reachTwoFactorStep();

    fireEvent.change(screen.getByLabelText('Código do aplicativo'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /Verificar/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Código de verificação inválido.');
    expect(screen.getByLabelText('Código do aplicativo')).toHaveValue('');
    expect(screen.getByRole('heading', { name: 'Verificação em duas etapas' })).toBeInTheDocument();
    expect(onLogin).not.toHaveBeenCalled();
  });

  it('código de recuperação: troca o rótulo, envia o código e avisa quantos restam', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    apiFetchMock
      .mockResolvedValueOnce({ twoFactorRequired: true })
      .mockResolvedValueOnce({ token: 'tok', user: USER, recoveryCodeUsed: true, recoveryCodesRemaining: 9 });
    const onLogin = await reachTwoFactorStep();

    fireEvent.click(screen.getByRole('button', { name: 'Usar um código de recuperação' }));
    const input = screen.getByLabelText('Código de recuperação');
    expect(input).toHaveAttribute('inputmode', 'text');
    fireEvent.change(input, { target: { value: 'ABCDE-FGHJK' } });
    fireEvent.click(screen.getByRole('button', { name: /Verificar/ }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('tok', USER));
    expect(apiFetchMock).toHaveBeenLastCalledWith('/api/auth/login', {
      method: 'POST', body: { email: USER.email, password: 'senha123', code: 'ABCDE-FGHJK' },
    });
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Restam 9 códigos.'));
  });

  it('"Voltar" retorna ao e-mail e senha, com a senha em branco', async () => {
    apiFetchMock.mockResolvedValueOnce({ twoFactorRequired: true });
    await reachTwoFactorStep();

    fireEvent.click(screen.getByRole('button', { name: /Voltar/ }));
    expect(screen.getByText('Bem-vindo de volta!')).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail')).toHaveValue(USER.email);
    expect(screen.getByLabelText('Senha')).toHaveValue('');
  });

  it('resposta sem token (formato inesperado) não entra e mostra erro', async () => {
    apiFetchMock.mockResolvedValueOnce({ ok: true });
    const onLogin = vi.fn();
    render(<AuthForm onLogin={onLogin} />);
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: /Entrar no Sistema/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Resposta inesperada do servidor.');
    expect(onLogin).not.toHaveBeenCalled();
  });

  it('recoveryNotice: singular, plural, nenhum restante e quantidade desconhecida', () => {
    expect(recoveryNotice(1)).toContain('Resta 1 código.');
    expect(recoveryNotice(4)).toContain('Restam 4 códigos.');
    expect(recoveryNotice(0)).toContain('Não resta nenhum código.');
    expect(recoveryNotice(null)).not.toMatch(/Resta/);
  });
});
