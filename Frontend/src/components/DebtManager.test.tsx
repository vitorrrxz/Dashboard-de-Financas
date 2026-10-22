// @vitest-environment jsdom
// Dívidas cadastradas: botão de cadastrar no topo, conta por banco e pagamento dividido em partes.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DebtManager } from './DebtManager';
import type { Account, Debt } from '../types';

const checking: Account = { id: 'cc', name: 'Conta', bank: 'Nubank', type: 'checking', balance: 0, color: '#fff' };
const card: Account = { id: 'card', name: 'Cartão', bank: 'Nubank', type: 'credit', balance: 0, color: '#fff' };

function debt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: 'd1', name: 'Financiamento', category: 'Financiamento', totalAmount: 3000, paidAmount: 0, monthlyPayment: 1000,
    totalInstallments: 3, paidInstallments: 0, nextDueDate: '2099-01-10', createdAt: '2026-01-01', accountId: 'cc',
    ...overrides,
  };
}

function renderManager(debts: Debt[] = []) {
  const handlers = {
    onAdd: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onPaySplit: vi.fn().mockResolvedValue(undefined),
  };
  render(<DebtManager debts={debts} accounts={[checking, card]} {...handlers} />);
  return handlers;
}

function fillNewDebt() {
  fireEvent.click(screen.getByRole('button', { name: /Adicionar Dívida/ }));
  fireEvent.change(screen.getByLabelText('Nome da Dívida'), { target: { value: 'Financiamento' } });
  fireEvent.change(screen.getByLabelText('Valor Total (R$)'), { target: { value: '3000' } });
  fireEvent.change(screen.getByLabelText('Nº Total de Parcelas'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('Próximo Vencimento'), { target: { value: '2099-01-10' } });
  fireEvent.change(screen.getByLabelText('Vincular à Conta'), { target: { value: 'nubank' } });
}

afterEach(() => vi.restoreAllMocks());

describe('DebtManager', () => {
  it('o banco aparece uma vez só e grava a conta corrente', async () => {
    const { onAdd } = renderManager();
    fillNewDebt();
    const options = within(screen.getByLabelText('Vincular à Conta')).getAllByRole('option').map(o => o.textContent);
    expect(options).toEqual(['Selecione uma conta', 'Nubank']);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd.mock.calls[0][0]).toMatchObject({ accountId: 'cc', monthlyPayment: 1000, splits: [] });
  });

  it('dividir pagamento sugere duas metades e salva as partes', async () => {
    const { onAdd } = renderManager();
    fillNewDebt();
    fireEvent.click(screen.getByLabelText('Dividir pagamento'));
    expect(screen.getByLabelText('Dia · parte 1')).toHaveProperty('value', '10');
    expect(screen.getByLabelText('Dia · parte 2')).toHaveProperty('value', '25');
    fireEvent.change(screen.getAllByLabelText('Valor (R$)')[0], { target: { value: '600' } });
    fireEvent.change(screen.getAllByLabelText('Valor (R$)')[1], { target: { value: '400' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd.mock.calls[0][0].splits).toEqual([{ day: 10, amount: 600 }, { day: 25, amount: 400 }]);
  });

  it('partes que não fecham a parcela não salvam e mostram o aviso', () => {
    const { onAdd } = renderManager();
    fillNewDebt();
    fireEvent.click(screen.getByLabelText('Dividir pagamento'));
    fireEvent.change(screen.getAllByLabelText('Valor (R$)')[0], { target: { value: '300' } });
    expect(screen.getByText('Soma R$ 800,00 de R$ 1.000,00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(screen.getByRole('alert').textContent).toBe('As partes precisam somar a parcela mensal (R$ 1.000,00).');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('no card, cada parte tem o seu "Pagar"; a paga mostra "Paga" e o que falta no mês', () => {
    const { onPaySplit, onUpdate } = renderManager([debt({
      paidAmount: 600,
      splits: [{ id: 's1', day: 10, amount: 600, paid: true }, { id: 's2', day: 25, amount: 400, paid: false }],
    })]);
    expect(screen.queryByRole('button', { name: 'Pagar parcela' })).toBeNull();
    const parts = screen.getByRole('list', { name: 'Partes do pagamento de Financiamento' });
    expect(within(parts).getByText('Paga')).toBeTruthy();
    expect(within(parts).getByText('Falta R$ 400,00 neste mês')).toBeTruthy();
    fireEvent.click(within(parts).getByRole('button', { name: 'Pagar a parte do dia 25 de Financiamento' }));
    expect(onPaySplit).toHaveBeenCalledWith('d1', 's2');
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('"Pagar todas as parcelas do mês" paga as partes que faltam e a parcela inteira das outras', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const plain = debt({ id: 'd2', name: 'Empréstimo' });
    const { onPaySplit, onUpdate } = renderManager([
      debt({ splits: [{ id: 's1', day: 10, amount: 600, paid: true }, { id: 's2', day: 25, amount: 400, paid: false }] }),
      plain,
    ]);
    fireEvent.click(screen.getByRole('button', { name: /Pagar todas as parcelas do mês/ }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(onPaySplit.mock.calls).toEqual([['d1', 's2']]);
    expect(onUpdate).toHaveBeenCalledWith('d2', expect.objectContaining({ paidInstallments: 1 }));
  });

  it('cadastrar e as ações em lote ficam acima das dívidas', () => {
    renderManager([debt()]);
    const add = screen.getByRole('button', { name: /Adicionar Dívida/ });
    const payAll = screen.getByRole('button', { name: /Pagar todas as parcelas do mês/ });
    const firstDebt = screen.getByRole('heading', { name: 'Financiamento' });
    expect(add.compareDocumentPosition(firstDebt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(payAll.compareDocumentPosition(firstDebt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
