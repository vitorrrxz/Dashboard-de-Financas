// @vitest-environment jsdom
// FIN-030 (base de testes do frontend), FIN-078 (segundo passo do login quando a conta tem
// verificação em duas etapas) e FIN-121 (login pelo Better Auth, via services/auth).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthForm } from './AuthForm';
import { recoveryNotice } from '../utils/twoFactor';
import { signIn, signUp, verifyTwoFactor } from '../services/auth';

vi.mock('../services/auth', () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  verifyTwoFactor: vi.fn(),
}));

const signInMock = vi.mocked(signIn);
const signUpMock = vi.mocked(signUp);
const verifyMock = vi.mocked(verifyTwoFactor);
const USER = { id: 'u1', name: 'Fulano', email: 'fulano@teste.com' };

function fillCredentials() {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: USER.email } });
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha123' } });
}

/** Faz o primeiro envio (e-mail e senha) com o servidor pedindo o segundo fator. */
async function reachTwoFactorStep(onLogin = vi.fn()) {
  signInMock.mockResolvedValueOnce({ twoFactorRequired: true });
  render(<AuthForm onLogin={onLogin} />);
  fillCredentials();
  fireEvent.click(screen.getByRole('button', { name: /Entrar no Sistema/ }));
  expect(await screen.findByRole('heading', { name: 'Verificação em duas etapas' })).toBeInTheDocument();
  return onLogin;
}

describe('AuthForm', () => {
  beforeEach(() => {
    signInMock.mockReset();
    signUpMock.mockReset();
    verifyMock.mockReset();
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

  it('cadastro envia nome, e-mail e senha e entra com o usuário criado', async () => {
    signUpMock.mockResolvedValueOnce(USER);
    const onLogin = vi.fn();
    render(<AuthForm onLogin={onLogin} />);
    fireEvent.click(screen.getByText('Cadastre-se'));
    fireEvent.change(await screen.findByLabelText('Nome Completo'), { target: { value: USER.name } });
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: /Criar Conta/ }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(USER));
    expect(signUpMock).toHaveBeenCalledWith(USER.name, USER.email, 'senha123');
  });

  it('sem verificação em duas etapas, entra direto com e-mail e senha', async () => {
    signInMock.mockResolvedValueOnce({ user: USER });
    const onLogin = vi.fn();
    render(<AuthForm onLogin={onLogin} />);
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: /Entrar no Sistema/ }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(USER));
    expect(signInMock).toHaveBeenCalledWith(USER.email, 'senha123');
  });

  it('credenciais recusadas: mostra a mensagem e não entra', async () => {
    signInMock.mockRejectedValueOnce(new Error('Credenciais inválidas'));
    const onLogin = vi.fn();
    render(<AuthForm onLogin={onLogin} />);
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: /Entrar no Sistema/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Credenciais inválidas');
    expect(onLogin).not.toHaveBeenCalled();
  });

  it('com a verificação ativa, pede o código do aplicativo e entra com ele', async () => {
    verifyMock.mockResolvedValueOnce(USER);
    const onLogin = await reachTwoFactorStep();
    expect(onLogin).not.toHaveBeenCalled();

    const codeInput = screen.getByLabelText('Código do aplicativo');
    expect(codeInput).toHaveAttribute('autocomplete', 'one-time-code');
    expect(codeInput).toHaveAttribute('inputmode', 'numeric');
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Verificar/ }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(USER));
    expect(verifyMock).toHaveBeenCalledWith('123456', false);
  });

  it('código recusado: mostra o erro, limpa o campo e continua no passo do código', async () => {
    verifyMock.mockRejectedValueOnce(new Error('Código de verificação inválido.'));
    const onLogin = await reachTwoFactorStep();

    fireEvent.change(screen.getByLabelText('Código do aplicativo'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /Verificar/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Código de verificação inválido.');
    expect(screen.getByLabelText('Código do aplicativo')).toHaveValue('');
    expect(screen.getByRole('heading', { name: 'Verificação em duas etapas' })).toBeInTheDocument();
    expect(onLogin).not.toHaveBeenCalled();
  });

  it('código de recuperação: troca o rótulo, envia como recuperação e avisa que ele deixou de valer', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    verifyMock.mockResolvedValueOnce(USER);
    const onLogin = await reachTwoFactorStep();

    fireEvent.click(screen.getByRole('button', { name: 'Usar um código de recuperação' }));
    const input = screen.getByLabelText('Código de recuperação');
    expect(input).toHaveAttribute('inputmode', 'text');
    fireEvent.change(input, { target: { value: 'ABCDE-FGHJK' } });
    fireEvent.click(screen.getByRole('button', { name: /Verificar/ }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(USER));
    expect(verifyMock).toHaveBeenCalledWith('ABCDE-FGHJK', true);
    expect(alertSpy).toHaveBeenCalledWith(recoveryNotice(null));
  });

  it('"Voltar" retorna ao e-mail e senha, com a senha em branco', async () => {
    await reachTwoFactorStep();

    fireEvent.click(screen.getByRole('button', { name: /Voltar/ }));
    expect(screen.getByText('Bem-vindo de volta!')).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail')).toHaveValue(USER.email);
    expect(screen.getByLabelText('Senha')).toHaveValue('');
  });
});
