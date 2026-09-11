// FIN-072 — tela da carteira de investimentos (e FIN-076 — moeda por posição).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { InvestmentsManager } from './InvestmentsManager';
import type { Account, Investment } from '../types';

const broker: Account = { id: 'xp', name: 'XP', bank: 'XP Investimentos', type: 'investment', balance: 10000, color: '#6366f1' };
const card: Account = { id: 'nu', name: 'Nubank', bank: 'Nubank', type: 'credit', balance: 0, color: '#a855f7' };
const checking: Account = { id: 'cc', name: 'Conta Corrente', bank: 'Itaú', type: 'checking', balance: 800, color: '#14b8a6' };

function position(overrides: Partial<Investment> = {}): Investment {
  return {
    id: 'i1', name: 'CDB Inter', type: 'fixed_income', amountInvested: 1000, currentValue: 1150,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderManager(props: Partial<Parameters<typeof InvestmentsManager>[0]> = {}) {
  const handlers = {
    onAdd: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
  };
  render(<InvestmentsManager investments={[]} accounts={[broker, card, checking]} {...handlers} {...props}/>);
  return handlers;
}

function openAddForm() {
  fireEvent.click(screen.getByRole('button', { name: /Adicionar Investimento/ }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InvestmentsManager', () => {
  it('mostra o estado vazio', () => {
    renderManager();
    expect(screen.getByText('Nenhum investimento cadastrado')).toBeInTheDocument();
  });

  it('mostra o resultado de cada posição e da carteira, sem percentual quando não há valor aplicado', () => {
    renderManager({
      investments: [
        position(),
        position({ id: 'i2', name: 'Bonificação', type: 'stocks', amountInvested: 0, currentValue: 200 }),
      ],
    });
    // CDB: +150 sobre 1.000 aplicados = +15%. Bonificação: nada aplicado, então sem percentual.
    expect(screen.getByText('+R$ 150,00 (+15,00%)')).toBeInTheDocument();
    expect(screen.getByText('+R$ 200,00')).toBeInTheDocument();
    // Carteira: vale 1.350 com 1.000 aplicados.
    expect(screen.getByText('R$ 1.350,00')).toBeInTheDocument();
    expect(screen.getByText('+R$ 350,00')).toBeInTheDocument();
    expect(screen.getByText('+35,00% sobre o aplicado')).toBeInTheDocument();
  });

  it('prejuízo aparece com sinal negativo', () => {
    renderManager({ investments: [position({ amountInvested: 2000, currentValue: 1500 })] });
    expect(screen.getByText('−R$ 500,00 (−25,00%)')).toBeInTheDocument();
  });

  it('mostra a alocação por tipo com a participação de cada um', () => {
    renderManager({
      investments: [position({ currentValue: 750 }), position({ id: 'i2', name: 'BTC', type: 'crypto', currentValue: 250 })],
    });
    const allocation = screen.getByRole('region', { name: 'Alocação por tipo' });
    expect(within(allocation).getByText('75%')).toBeInTheDocument();
    expect(within(allocation).getByText('25%')).toBeInTheDocument();
  });

  it('explica como cada conta de investimento entra no patrimônio (FIN-073)', () => {
    const covered = { ...broker };
    const uncovered: Account = { ...broker, id: 'rico', name: 'Rico', balance: 3000 };
    renderManager({
      accounts: [covered, uncovered],
      investments: [position({ accountId: 'xp', currentValue: 9000 })],
    });
    expect(screen.getByText(/entra pelas posições vinculadas \(R\$ 9\.000,00\); o saldo digitado na conta \(R\$ 10\.000,00\) fica de fora/))
      .toBeInTheDocument();
    expect(screen.getByText(/entra pelo saldo da conta \(R\$ 3\.000,00\), porque ainda não tem posições vinculadas/))
      .toBeInTheDocument();
  });

  it('associa cada rótulo ao seu campo e não oferece cartão de crédito como conta', () => {
    renderManager();
    openAddForm();
    expect(screen.getByRole('dialog', { name: 'Novo Investimento' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nome')).toBeInTheDocument();
    expect(screen.getByLabelText('Tipo')).toBeInTheDocument();
    expect(screen.getByLabelText('Moeda')).toHaveValue('BRL');
    expect(screen.getByLabelText('Valor Aplicado (R$)')).toBeInTheDocument();
    expect(screen.getByLabelText('Valor Atual (R$)')).toHaveAccessibleDescription(/Em branco, usa o valor aplicado/);

    const options = within(screen.getByLabelText('Conta')).getAllByRole('option').map(o => o.textContent);
    expect(options).toEqual(['Sem conta vinculada', 'XP — XP Investimentos', 'Conta Corrente — Itaú']);
  });

  it('cadastra com o valor atual em branco usando o valor aplicado', async () => {
    const { onAdd } = renderManager();
    openAddForm();
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: '  Tesouro Selic  ' } });
    fireEvent.change(screen.getByLabelText('Conta'), { target: { value: 'xp' } });
    fireEvent.change(screen.getByLabelText('Valor Aplicado (R$)'), { target: { value: '2500.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith({
      name: 'Tesouro Selic', type: 'fixed_income', accountId: 'xp', currency: 'BRL',
      amountInvested: 2500.5, currentValue: 2500.5,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('um 0 digitado no valor atual é respeitado — não vira o valor aplicado', async () => {
    const { onAdd } = renderManager();
    openAddForm();
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Ação que virou pó' } });
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'stocks' } });
    fireEvent.change(screen.getByLabelText('Valor Aplicado (R$)'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Valor Atual (R$)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith({
      name: 'Ação que virou pó', type: 'stocks', accountId: undefined, currency: 'BRL',
      amountInvested: 500, currentValue: 0,
    });
  });

  it('não envia sem nome e explica o motivo', () => {
    const { onAdd } = renderManager();
    openAddForm();
    fireEvent.change(screen.getByLabelText('Valor Aplicado (R$)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome do investimento.');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('não envia valor negativo e explica o motivo', () => {
    const { onAdd } = renderManager();
    openAddForm();
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'CDB' } });
    fireEvent.change(screen.getByLabelText('Valor Aplicado (R$)'), { target: { value: '-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o valor aplicado');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('edita a posição a partir dos valores atuais e envia a atualização', async () => {
    const { onUpdate } = renderManager({ investments: [position({ accountId: 'xp' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Editar CDB Inter' }));
    expect(screen.getByLabelText('Nome')).toHaveValue('CDB Inter');
    expect(screen.getByLabelText('Conta')).toHaveValue('xp');
    expect(screen.getByLabelText('Valor Atual (R$)')).toHaveValue(1150);

    fireEvent.change(screen.getByLabelText('Valor Atual (R$)'), { target: { value: '1210.75' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate).toHaveBeenCalledWith('i1', {
      name: 'CDB Inter', type: 'fixed_income', accountId: 'xp', currency: 'BRL',
      amountInvested: 1000, currentValue: 1210.75,
    });
  });

  it('posição vinculada a um cartão abre sem conta — salvar desfaz o vínculo', async () => {
    const { onUpdate } = renderManager({ investments: [position({ accountId: 'nu' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Editar CDB Inter' }));
    expect(screen.getByLabelText('Conta')).toHaveValue('');

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate.mock.calls[0][1].accountId).toBeUndefined();
  });

  it('mantém o formulário aberto quando a gravação falha', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { onAdd } = renderManager();
    onAdd.mockRejectedValueOnce(new Error('falhou'));
    openAddForm();
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'CDB' } });
    fireEvent.change(screen.getByLabelText('Valor Aplicado (R$)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Adicionar' })).toBeEnabled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('exclui só depois da confirmação', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { onDelete } = renderManager({ investments: [position()] });

    fireEvent.click(screen.getByRole('button', { name: 'Excluir CDB Inter' }));
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Excluir CDB Inter' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('i1'));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
  });

  it('fecha o formulário com Esc', () => {
    renderManager();
    openAddForm();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('um tipo desconhecido vindo da API não quebra a lista', () => {
    renderManager({ investments: [position({ type: 'constructor' as Investment['type'], name: 'Tipo estranho' })] });
    expect(screen.getByText('Tipo estranho')).toBeInTheDocument();
    // O tipo desconhecido vira "Outros" nos dois lugares: na linha da posição e na alocação.
    expect(screen.getByText(/^Outros · atualizado/)).toBeInTheDocument();
    const allocation = screen.getByRole('region', { name: 'Alocação por tipo' });
    expect(within(allocation).getByText('Outros')).toBeInTheDocument();
  });

  describe('moedas (FIN-076)', () => {
    it('mostra a posição na própria moeda e soma a carteira em real pela cotação', () => {
      renderManager({
        rates: { date: '2026-09-10', rates: { USD: 5 }, stale: false },
        investments: [position({ name: 'VOO', type: 'stocks', currency: 'USD', amountInvested: 100, currentValue: 120 })],
      });
      expect(screen.getByText('US$ 120,00')).toBeInTheDocument();
      expect(screen.getByText('+US$ 20,00 (+20,00%)')).toBeInTheDocument();
      // Resumo em real: 120 × 5 = 600 de valor atual e 100 × 5 = 500 aplicados.
      expect(screen.getByText('R$ 600,00')).toBeInTheDocument();
      expect(screen.getByText('R$ 500,00')).toBeInTheDocument();
      expect(screen.getByText('+R$ 100,00')).toBeInTheDocument();
    });

    it('posição numa moeda sem cotação fica fora dos totais, com aviso, mas continua na lista', () => {
      renderManager({ investments: [position({ currency: 'USD', amountInvested: 100, currentValue: 120 })] });
      expect(screen.getByRole('status')).toHaveTextContent('1 posição(ões) em USD fora dos totais');
      expect(screen.getByText('US$ 120,00')).toBeInTheDocument();
      // Somar o dólar como real daria R$ 120,00 de valor atual — que não pode aparecer.
      expect(screen.queryByText('R$ 120,00')).not.toBeInTheDocument();
    });

    it('escolher uma conta em dólar traz a moeda dela para o formulário', () => {
      const avenue: Account = { id: 'av', name: 'Avenue', bank: 'Avenue', type: 'investment', balance: 0, currency: 'USD', color: '#fff' };
      renderManager({ accounts: [broker, avenue] });
      openAddForm();
      fireEvent.change(screen.getByLabelText('Conta'), { target: { value: 'av' } });
      expect(screen.getByLabelText('Moeda')).toHaveValue('USD');
      expect(screen.getByLabelText('Valor Aplicado (US$)')).toBeInTheDocument();
    });
  });
});
