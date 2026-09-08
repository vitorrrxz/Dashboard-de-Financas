// Teste de exemplo do FIN-030 — confirma que a base de testes do frontend (Vitest +
// Testing Library + jsdom) está funcional, renderizando um componente real do app.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthForm } from './AuthForm';

describe('AuthForm', () => {
  it('renderiza o formulário de login por padrão', () => {
    render(<AuthForm onLogin={() => {}} />);
    expect(screen.getByText('Bem-vindo de volta!')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('seu@email.com')).toBeInTheDocument();
  });

  it('alterna para o formulário de cadastro ao clicar em "Cadastre-se"', async () => {
    const { getByText } = render(<AuthForm onLogin={() => {}} />);
    getByText('Cadastre-se').click();
    expect(await screen.findByText('Crie sua conta')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Nome completo')).toBeInTheDocument();
  });
});
