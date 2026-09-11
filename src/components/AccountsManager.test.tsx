// FIN-076 — moeda por conta na aba Contas.
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccountsManager } from './AccountsManager';
import type { Account } from '../types';
import type { ExchangeRates } from '../utils/currency';

const RATES: ExchangeRates = { date: '2026-09-10', rates: { USD: 5 }, stale: false };
const itau: Account = { id: 'itau', name: 'Itaú', bank: 'Itaú', type: 'checking', balance: 1000, currency: 'BRL', color: '#6366f1' };
const wise: Account = { id: 'wise', name: 'Wise', bank: 'Wise', type: 'checking', balance: 200, currency: 'USD', color: '#14b8a6' };

function renderManager(props: Partial<Parameters<typeof AccountsManager>[0]> = {}) {
  const handlers = {
    onAdd: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
  };
  render(<AccountsManager accounts={[itau, wise]} {...handlers} {...props}/>);
  return handlers;
}

describe('AccountsManager — moedas (FIN-076)', () => {
  it('mostra cada conta na própria moeda', () => {
    renderManager({ rates: RATES });
    expect(screen.getByText('US$ 200,00')).toBeInTheDocument();
    expect(screen.getByText('R$ 1.000,00')).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument(); // selo de moeda só na conta estrangeira
  });

  it('soma o saldo total em real, convertendo pela cotação', () => {
    renderManager({ rates: RATES });
    // 1.000 + 200 × 5 = 2.000.
    expect(screen.getByText('R$ 2.000,00')).toBeInTheDocument();
  });

  it('sem cotação, a conta em dólar fica fora do total — e a tela avisa', () => {
    renderManager({ rates: null });
    expect(screen.getByRole('status')).toHaveTextContent('1 conta(s) em USD fora dos totais');
    // Somar o dólar como real daria R$ 1.200,00 — que não pode aparecer.
    expect(screen.queryByText('R$ 1.200,00')).not.toBeInTheDocument();
    expect(screen.getAllByText('R$ 1.000,00')).toHaveLength(2); // total (só o Itaú) e o card do Itaú
  });

  it('o seletor de moeda tem rótulo associado, e os campos de valor seguem a moeda escolhida', () => {
    renderManager();
    fireEvent.click(screen.getByRole('button', { name: /Adicionar Conta/ }));
    const select = screen.getByLabelText('Moeda');
    expect(select).toHaveValue('BRL');
    fireEvent.change(select, { target: { value: 'EUR' } });
    expect(screen.getByLabelText('Saldo Atual (€)')).toBeInTheDocument();
  });

  it('trocar a moeda de uma conta existente avisa que as transações acompanham, sem conversão', () => {
    renderManager();
    fireEvent.click(screen.getByRole('button', { name: 'Editar Itaú' }));
    expect(screen.getByLabelText('Moeda')).not.toHaveAccessibleDescription();
    fireEvent.change(screen.getByLabelText('Moeda'), { target: { value: 'USD' } });
    expect(screen.getByLabelText('Moeda')).toHaveAccessibleDescription(/transações desta conta passam para a nova moeda/);
  });

  it('salva a moeda escolhida', async () => {
    const { onAdd } = renderManager();
    fireEvent.click(screen.getByRole('button', { name: /Adicionar Conta/ }));
    fireEvent.change(screen.getByLabelText('Nome da Conta'), { target: { value: 'Nomad' } });
    fireEvent.change(screen.getByLabelText('Banco / Operadora'), { target: { value: 'Nomad' } });
    fireEvent.change(screen.getByLabelText('Moeda'), { target: { value: 'USD' } });
    fireEvent.change(screen.getByLabelText('Saldo Atual (US$)'), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'Nomad', currency: 'USD', balance: 150 });
  });

  it('moeda fora da lista (vinda da Pluggy) aparece no seletor e não é reenviada ao salvar', async () => {
    const pluggyArs: Account = { ...itau, id: 'ars', name: 'Conta ARS', currency: 'ARS' };
    const { onUpdate } = renderManager({ accounts: [pluggyArs] });
    fireEvent.click(screen.getByRole('button', { name: 'Editar Conta ARS' }));
    expect(screen.getByLabelText('Moeda')).toHaveValue('ARS');

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate.mock.calls[0][1]).not.toHaveProperty('currency');
  });
});
