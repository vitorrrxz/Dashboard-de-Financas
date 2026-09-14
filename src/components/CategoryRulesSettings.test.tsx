// FIN-106 — tela de regras de categoria: listar, trocar a categoria, criar e excluir.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CategoryRulesSettings } from './CategoryRulesSettings';
import { apiFetch, ApiError } from '../services/api';

vi.mock('../services/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);
const UBER = { id: 'r1', match: 'Uber', category: 'Transporte' };

beforeEach(() => apiFetchMock.mockReset());

describe('CategoryRulesSettings (FIN-106)', () => {
  it('lista as regras e troca a categoria pela mesma rota da criação, pelo texto', async () => {
    apiFetchMock.mockResolvedValueOnce([UBER]).mockResolvedValueOnce({ ...UBER, category: 'Lazer', updated: 0 });
    render(<CategoryRulesSettings token="tk" />);

    fireEvent.change(await screen.findByLabelText('Categoria de "Uber"'), { target: { value: 'Lazer' } });

    await waitFor(() => expect(screen.getByLabelText('Categoria de "Uber"')).toHaveValue('Lazer'));
    expect(apiFetchMock).toHaveBeenLastCalledWith('/api/category-rules', { method: 'POST', body: { match: 'Uber', category: 'Lazer' }, token: 'tk' });
  });

  it('cria uma regra pelo formulário e limpa o campo de texto', async () => {
    apiFetchMock.mockResolvedValueOnce([]).mockResolvedValueOnce({ id: 'r2', match: 'Padaria', category: 'Alimentação' });
    render(<CategoryRulesSettings token="tk" />);
    await screen.findByText(/Nenhuma regra ainda/);

    fireEvent.change(screen.getByLabelText('Texto na descrição'), { target: { value: 'Padaria' } });
    fireEvent.change(screen.getByLabelText('Categoria'), { target: { value: 'Alimentação' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar regra' }));

    expect(await screen.findByLabelText('Categoria de "Padaria"')).toHaveValue('Alimentação');
    expect(screen.getByLabelText('Texto na descrição')).toHaveValue('');
    expect(apiFetchMock).toHaveBeenLastCalledWith('/api/category-rules', { method: 'POST', body: { match: 'Padaria', category: 'Alimentação' }, token: 'tk' });
  });

  it('exclusão que falha mostra o erro do servidor e mantém a regra na lista', async () => {
    apiFetchMock.mockResolvedValueOnce([UBER]).mockRejectedValueOnce(new ApiError('Erro ao excluir a regra de categoria.', 500, {}));
    render(<CategoryRulesSettings token="tk" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Excluir a regra "Uber"' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Erro ao excluir a regra de categoria.');
    expect(screen.getByLabelText('Categoria de "Uber"')).toBeInTheDocument();
    expect(apiFetchMock).toHaveBeenLastCalledWith('/api/category-rules/r1', { method: 'DELETE', token: 'tk' });
  });

  it('resposta fora do formato ao salvar vira mensagem de erro, sem quebrar a tela', async () => {
    apiFetchMock.mockResolvedValueOnce([UBER]).mockResolvedValueOnce({ ok: true });
    render(<CategoryRulesSettings token="tk" />);

    fireEvent.change(await screen.findByLabelText('Categoria de "Uber"'), { target: { value: 'Lazer' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Resposta inesperada do servidor.');
    expect(screen.getByLabelText('Categoria de "Uber"')).toHaveValue('Transporte');
  });
});
