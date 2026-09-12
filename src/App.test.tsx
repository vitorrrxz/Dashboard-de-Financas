// FIN-099 — as ações de cada transação precisam funcionar sem mouse: nome acessível nos botões,
// visíveis com o foco do teclado e em tela de toque (não só com `group-hover`), e o modal de edição
// com os rótulos associados aos campos.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TxTable } from './App';
import type { Transaction } from './types';

const uber: Transaction = {
  id: 'tx-1', name: 'Uber', category: 'Transporte', date: '2026-09-10', amount: -2590, paymentType: 'debit',
};

function renderTable() {
  const onUpdate = vi.fn<(id: string, tx: Partial<Transaction>) => Promise<void>>().mockResolvedValue(undefined);
  const onDelete = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
  render(<TxTable rows={[uber]} accounts={[]} onUpdate={onUpdate} onDelete={onDelete} />);
  return { onUpdate, onDelete };
}

afterEach(() => vi.restoreAllMocks());

describe('TxTable — ações de cada transação (FIN-099)', () => {
  it('editar e excluir são botões com o nome da transação', () => {
    renderTable();
    expect(screen.getByRole('button', { name: 'Editar Uber' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: 'Excluir Uber' })).toHaveAttribute('type', 'button');
  });

  it('as ações aparecem com o foco do teclado e em tela de toque, não só com o mouse', () => {
    renderTable();
    const actions = screen.getByRole('button', { name: 'Editar Uber' }).parentElement;
    expect(actions).toHaveClass('opacity-0', 'group-hover:opacity-100', 'focus-within:opacity-100', 'pointer-coarse:opacity-100');
    expect(actions).toContainElement(screen.getByRole('button', { name: 'Excluir Uber' }));
  });

  it('excluir pede confirmação e só chama onDelete quando confirmado', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { onDelete } = renderTable();
    const button = screen.getByRole('button', { name: 'Excluir Uber' });

    fireEvent.click(button);
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledWith('Excluir a transação "Uber"?');
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('tx-1');
  });

  it('editar abre o modal com cada campo rotulado e preenchido; "Fechar" o fecha', () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Editar Uber' }));

    expect(screen.getByRole('heading', { name: 'Editar Transação' })).toBeInTheDocument();
    expect(screen.getByLabelText('Descrição')).toHaveValue('Uber');
    expect(screen.getByLabelText('Data')).toHaveValue('2026-09-10');
    expect(screen.getByLabelText(/^Valor/)).toHaveValue(-2590);
    expect(screen.getByLabelText('Categoria')).toHaveValue('Transporte');
    expect(screen.getByLabelText('Tipo')).toHaveValue('debit');
    expect(screen.getByLabelText('Conta')).toHaveDisplayValue('Sem conta vinculada');

    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('heading', { name: 'Editar Transação' })).not.toBeInTheDocument();
  });
});
