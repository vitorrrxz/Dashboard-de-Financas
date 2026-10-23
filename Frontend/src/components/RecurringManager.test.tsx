// @vitest-environment jsdom
// Devedores: vincular a pessoa a uma compra do cartão que não é dívida cadastrada.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RecurringManager } from './RecurringManager';
import { todayISO } from '../utils/debts';
import { billDueDate, nextDueOnOrAfter } from '../utils/dates';
import type { Account, Debt, RecurringTransaction, Transaction } from '../types';

const checking: Account = { id: 'cc', name: 'Conta', bank: 'Nubank', type: 'checking', balance: 0, color: '#fff' };
const card: Account = { id: 'card', name: 'Cartão', bank: 'Nubank', type: 'credit', balance: 0, color: '#fff', closingDay: 3, dueDay: 10 };
const other: Account = { id: 'itau', name: 'Conta Itaú', bank: 'Itaú', type: 'checking', balance: 0, color: '#fff' };
const loan: Debt = {
  id: 'd1', name: 'Empréstimo', category: 'Empréstimo', totalAmount: 900, paidAmount: 0, monthlyPayment: 300,
  totalInstallments: 3, paidInstallments: 0, nextDueDate: '2099-01-10', createdAt: '2026-01-01', accountId: 'itau',
};
const car: Debt = { ...loan, id: 'd2', name: 'carro', monthlyPayment: 500 };
const bike: Debt = { ...loan, id: 'd3', name: 'Bicicleta', monthlyPayment: 100 };
const purchase: Transaction = { id: 't1', name: 'Tênis', category: 'Compras', date: todayISO(), amount: -250, accountId: 'card', paymentType: 'credit' };

function renderManager(recurring: RecurringTransaction[] = [], transactions: Transaction[] = [purchase]) {
  const handlers = {
    onAdd: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onConfirmPayment: vi.fn().mockResolvedValue(undefined),
  };
  render(<RecurringManager recurring={recurring} accounts={[checking, card, other]} debts={[loan, car, bike]} transactions={transactions}
    transactionCategories={[]} kind="income" {...handlers} />);
  return handlers;
}

afterEach(() => vi.restoreAllMocks());

describe('RecurringManager — Devedores', () => {
  it('vincula a compra do cartão: sugere o valor e um pagamento só, e grava o nome da cobrança', async () => {
    const { onAdd } = renderManager();
    fireEvent.click(screen.getByRole('button', { name: /Adicionar devedor/ }));
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'João' } });
    const select = screen.getByLabelText('O que ele paga');
    const option = within(select).getByRole('option', { name: /Tênis/ }) as HTMLOptionElement;
    fireEvent.change(select, { target: { value: option.value } });
    expect(screen.getByLabelText('Valor (R$)')).toHaveProperty('value', '250');
    expect(screen.getByLabelText('Quantas vezes ele paga')).toHaveProperty('value', '1');
    // O vencimento vem da fatura do cartão em que a compra cai.
    const due = billDueDate(todayISO(), 10, 3);
    expect(screen.getByLabelText('Próxima Ocorrência')).toHaveProperty('value', nextDueOnOrAfter(due > todayISO() ? due : todayISO(), 10));

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    // A conta vem do banco do cartão: a conta corrente do Nubank.
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'João', amount: 250, chargeName: 'Tênis', remainingPayments: 1, debtId: null, accountId: 'cc' });
  });

  it('vincular uma dívida puxa a conta dela', async () => {
    const { onAdd } = renderManager();
    fireEvent.click(screen.getByRole('button', { name: /Adicionar devedor/ }));
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Pedro' } });
    fireEvent.change(screen.getByLabelText('O que ele paga'), { target: { value: 'debt:d1' } });
    expect(screen.getByLabelText('Vincular à Conta')).toHaveProperty('value', 'itau');
    expect(screen.getByLabelText('Próxima Ocorrência')).toHaveProperty('value', '2099-01-10');
    // As opções vêm separadas por banco.
    const groups = Array.from(screen.getByLabelText('O que ele paga').querySelectorAll('optgroup'))
      .map(g => [g.label, Array.from(g.querySelectorAll('option'), o => o.textContent)]);
    expect(groups).toEqual([
      ['Nubank', [expect.stringMatching(/^Cartão · Tênis/)]],
      // Em ordem alfabética, sem diferenciar maiúscula.
      ['Itaú', [
        expect.stringMatching(/^Dívida · Bicicleta/), expect.stringMatching(/^Dívida · carro/), expect.stringMatching(/^Dívida · Empréstimo/),
      ]],
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd.mock.calls[0][0]).toMatchObject({ debtId: 'd1', amount: 300, accountId: 'itau' });
  });

  it('mostra a cobrança e quantos pagamentos faltam na lista', () => {
    renderManager([
      { id: 'r1', name: 'Ana', category: 'Receita', amount: 100, frequency: 'monthly', nextOccurrence: '2099-01-10', active: true,
        createdAt: '2026-01-01', chargeName: 'Loja X · 3x', remainingPayments: 2 },
      { id: 'r2', name: 'Bia', category: 'Receita', amount: 100, frequency: 'monthly', nextOccurrence: '2099-01-10', active: true,
        createdAt: '2026-01-01', chargeName: 'Cinema', remainingPayments: 0 },
    ], [purchase, { id: 'pix', name: 'PIX ANA', category: 'Transferências', date: '2026-10-10', amount: 100, accountId: 'cc', recurringId: 'r1' }]);
    expect(screen.getByText(/faltam 2 pagamentos/)).toBeTruthy();
    // O PIX que deu baixa na Ana aparece como pagamento confirmado.
    expect(screen.getByText(/recebido em .*: pagamento confirmado/)).toBeTruthy();
    expect(screen.getByText(/pagou tudo, não entra mais/)).toBeTruthy();
  });
});

describe('RecurringManager — Confirmar pagamento e Finalizar devedor', () => {
  const ana: RecurringTransaction = {
    id: 'r1', name: 'Ana', category: 'Receita', amount: 100, frequency: 'monthly', nextOccurrence: todayISO(), active: true, createdAt: '2026-01-01',
  };
  const pix: Transaction = { id: 'pix', name: 'PIX ANA SOUZA', category: 'Transferências', date: todayISO(), amount: 100, accountId: 'cc' };

  it('PIX do mesmo valor perto do vencimento: o botão confirma o pagamento com ele', async () => {
    const { onConfirmPayment } = renderManager([ana], [pix]);
    expect(screen.getByText(/PIX ANA SOUZA/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Confirmar pagamento/ }));
    await waitFor(() => expect(onConfirmPayment).toHaveBeenCalledWith('r1', 'pix'));
  });

  it('sem PIX do mesmo valor, não há botão de confirmar', () => {
    renderManager([ana], [{ ...pix, amount: 99 }]);
    expect(screen.queryByRole('button', { name: /Confirmar pagamento/ })).toBeNull();
  });

  it('Finalizar devedor no lugar de pausar; finalizado, dá para reativar', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onUpdate } = renderManager([ana, { ...ana, id: 'r2', name: 'Bia', active: false }], []);
    expect(screen.queryByRole('button', { name: /Pausar/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar Ana' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('r1', { active: false }));
    expect(screen.getByText('Finalizado')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reativar Bia' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('r2', { active: true }));
  });
});
