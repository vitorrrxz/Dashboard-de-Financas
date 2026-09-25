// @vitest-environment jsdom
// Filtro por conta da aba Dívidas (compartilhado com Transações, ver AccountFilter).
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DebtsPage } from './DebtsPage';
import type { Account, Debt } from '../types';

const account = (id: string, name: string): Account =>
  ({ id, name, bank: 'Banco', type: 'credit', balance: 0, color: '#fff' });

const debt = (id: string, name: string, accountId?: string): Debt => ({
  id, name, accountId, category: 'Cartão de Crédito', totalAmount: 100, paidAmount: 0, monthlyPayment: 100,
  totalInstallments: 1, paidInstallments: 0, nextDueDate: '2099-01-10', createdAt: '2026-01-01',
});

const accounts = [account('a', 'Nubank'), account('b', 'Inter')];
const debts = [debt('d1', 'Fatura Nubank', 'a'), debt('d2', 'Fatura Inter', 'b'), debt('d3', 'Empréstimo avulso')];

function renderPage(accountId: string | null, pageAccounts = accounts) {
  const onChangeAccount = vi.fn();
  render(<DebtsPage transactionsBase={[]} debts={debts} accounts={pageAccounts} accountId={accountId}
    onChangeAccount={onChangeAccount} onAdd={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()}/>);
  return onChangeAccount;
}

const shown = (name: string) => screen.queryAllByText(name).length > 0;

describe('DebtsPage — filtro por conta', () => {
  it('sem filtro, mostra as dívidas de todas as contas e as sem conta', () => {
    renderPage(null);
    expect(shown('Fatura Nubank')).toBe(true);
    expect(shown('Fatura Inter')).toBe(true);
    expect(shown('Empréstimo avulso')).toBe(true);
  });

  it('com uma conta escolhida, esconde as de outra conta e as sem conta', () => {
    renderPage('a');
    expect(shown('Fatura Nubank')).toBe(true);
    expect(shown('Fatura Inter')).toBe(false);
    expect(shown('Empréstimo avulso')).toBe(false);
  });

  it('"Todas as contas" volta o filtro para null', () => {
    const onChangeAccount = renderPage('a');
    fireEvent.change(screen.getByLabelText('Conta'), { target: { value: '' } });
    expect(onChangeAccount).toHaveBeenCalledWith(null);
  });

  it('com uma conta só, o filtro não aparece', () => {
    renderPage(null, [accounts[0]]);
    expect(screen.queryByLabelText('Conta')).not.toBeInTheDocument();
  });
});
