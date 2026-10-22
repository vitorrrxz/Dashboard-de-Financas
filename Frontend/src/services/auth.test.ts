// @vitest-environment jsdom
// FIN-122 — erro na volta do provedor de login (?error=): traduzido e tirado da barra de endereço.
import { describe, it, expect, afterEach } from 'vitest';
import { takeOAuthError } from './auth';

describe('takeOAuthError', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('sem erro na URL, não faz nada', () => {
    window.history.replaceState(null, '', '/#dashboard');
    expect(takeOAuthError()).toBeNull();
    expect(window.location.hash).toBe('#dashboard');
  });

  it('traduz o código e limpa a URL, mantendo a aba (#settings)', () => {
    window.history.replaceState(null, '', '/?error=account_not_linked&error_description=x#settings');
    expect(takeOAuthError()).toMatch(/Já existe uma conta com este e-mail/);
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#settings');
    expect(takeOAuthError()).toBeNull();
  });

  it('código desconhecido vira a mensagem genérica', () => {
    window.history.replaceState(null, '', '/?error=algo_novo');
    expect(takeOAuthError()).toBe('Não foi possível entrar com o provedor. Tente de novo.');
  });
});
