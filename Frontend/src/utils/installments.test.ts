// FIN-094 — compras parceladas no cartão e visão mensal de vencimentos.
import { describe, it, expect } from 'vitest';
import {
  dueItemsInMonth, dueMonths, groupInstallmentPurchases, isInstallmentTransaction,
  parseInstallment, summarizeDueItems,
} from './installments';
import type { Debt, Transaction } from '../types';

let seq = 0;
function tx(overrides: Partial<Transaction>): Transaction {
  seq += 1;
  return {
    id: `t${seq}`, name: 'Compra', category: 'Outros', date: '2026-09-10',
    amount: -10, paymentType: 'credit', accountId: 'card', ...overrides,
  };
}
function debt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: 'd1', name: 'Empréstimo', category: 'Empréstimo',
    totalAmount: 1000, paidAmount: 0, monthlyPayment: 250,
    totalInstallments: 4, paidInstallments: 0,
    nextDueDate: '2026-09-15', createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const TODAY = '2026-09-10';

describe('parseInstallment', () => {
  it('lê nome-base, parcela e total do sufixo "n/N"', () => {
    expect(parseInstallment('Mercado*Mercadolivre 3/10')).toEqual({ baseName: 'Mercado*Mercadolivre', number: 3, total: 10 });
  });

  it('aceita zero à esquerda', () => {
    expect(parseInstallment('Loja 03/10')).toEqual({ baseName: 'Loja', number: 3, total: 10 });
  });

  it('aceita a palavra "parcela"/"parc" e remove o separador solto do nome', () => {
    expect(parseInstallment('Loja X - Parcela 3/10')).toEqual({ baseName: 'Loja X', number: 3, total: 10 });
    expect(parseInstallment('LOJA PARC 3/10')).toEqual({ baseName: 'LOJA', number: 3, total: 10 });
  });

  it('não lê como parcela uma data no fim da descrição (parcela maior que o total)', () => {
    expect(parseInstallment('Compra 12/05')).toBeNull();
  });

  it('não considera "1/1" (à vista) nem parcela zero como parcelamento', () => {
    expect(parseInstallment('Loja 1/1')).toBeNull();
    expect(parseInstallment('Loja 0/3')).toBeNull();
  });

  it('exige um separador antes do número', () => {
    expect(parseInstallment('Loja3/10')).toBeNull();
  });

  it('devolve null quando não há sufixo', () => {
    expect(parseInstallment('Amazon BR VI')).toBeNull();
  });
});

describe('isInstallmentTransaction', () => {
  it('parcela de compra no cartão é parcelado', () => {
    expect(isInstallmentTransaction(tx({ name: 'Pag*Steam 3/4', amount: -57.64 }))).toBe(true);
  });

  it('compra à vista no cartão continua sendo transação comum', () => {
    expect(isInstallmentTransaction(tx({ name: 'Amazon BR VI', amount: -38.03 }))).toBe(false);
  });

  it('estorno com sufixo de parcela é entrada, não parcelado', () => {
    expect(isInstallmentTransaction(tx({ name: 'Estorno Loja 2/5', amount: 30 }))).toBe(false);
  });

  it('na conta corrente o sufixo sozinho não basta', () => {
    expect(isInstallmentTransaction(tx({ name: 'Transferência 1/2', paymentType: 'debit' }))).toBe(false);
  });

  it('saída importada como PIX parcelado é parcelado mesmo sem sufixo', () => {
    expect(isInstallmentTransaction(tx({ name: 'PIX João', paymentType: 'pix_installment' }))).toBe(true);
  });

  it('entrada marcada como PIX parcelado não é parcelado', () => {
    expect(isInstallmentTransaction(tx({ name: 'PIX João', paymentType: 'pix_installment', amount: 100 }))).toBe(false);
  });
});

describe('groupInstallmentPurchases', () => {
  // Recorte do extrato real que motivou FIN-094: a 1ª parcela carrega o arredondamento
  // (147,93 contra 147,89) e a 2ª não veio na sincronização.
  const mercadoLivre = [
    tx({ name: 'Mercado*Mercadolivre 1/10', date: '2026-08-08', amount: -147.93, category: 'Groceries' }),
    ...([
      [3, '2026-10-09'], [4, '2026-11-09'], [5, '2026-12-09'], [6, '2027-01-09'],
      [7, '2027-02-09'], [8, '2027-03-09'], [9, '2027-04-09'], [10, '2027-05-09'],
    ] as const).map(([n, date]) => tx({ name: `Mercado*Mercadolivre ${n}/10`, date, amount: -147.89, category: 'Groceries' })),
  ];

  it('reagrupa as parcelas numa única compra com todas as N parcelas', () => {
    const compras = groupInstallmentPurchases(mercadoLivre, TODAY);
    expect(compras).toHaveLength(1);
    expect(compras[0].name).toBe('Mercado*Mercadolivre');
    expect(compras[0].installments.map(i => i.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('deduz a parcela que faltou, no mês esperado e com o valor da mais recente', () => {
    const [compra] = groupInstallmentPurchases(mercadoLivre, TODAY);
    expect(compra.installments[1]).toEqual({ number: 2, date: '2026-09-09', amount: 147.89, estimated: true });
  });

  it('soma o total preservando o arredondamento da 1ª parcela', () => {
    const [compra] = groupInstallmentPurchases(mercadoLivre, TODAY);
    expect(compra.totalAmount).toBe(1478.94);
    expect(compra.installmentAmount).toBe(147.89);
  });

  it('conta como lançadas as parcelas com data até hoje e aponta a próxima', () => {
    const [compra] = groupInstallmentPurchases(mercadoLivre, TODAY);
    // 1/10 em 08/08 e a 2/10 (estimada) em 09/09 já estão em alguma fatura.
    expect(compra.chargedInstallments).toBe(2);
    expect(compra.chargedAmount).toBe(295.82);
    expect(compra.remainingAmount).toBe(1183.12);
    expect(compra.nextDate).toBe('2026-10-09');
  });

  it('toda parcela de cartão escondida da aba Transações aparece em alguma compra', () => {
    // As duas regras precisam concordar — senão uma parcela sumiria das duas abas.
    const escondidas = mercadoLivre.filter(isInstallmentTransaction).length;
    const agrupadas = groupInstallmentPurchases(mercadoLivre, TODAY)
      .flatMap(p => p.installments)
      .filter(i => !i.estimated).length;
    expect(agrupadas).toBe(escondidas);
  });

  it('parcela com data de hoje já conta como lançada', () => {
    const [compra] = groupInstallmentPurchases([
      tx({ name: 'Loja 1/2', date: TODAY }), tx({ name: 'Loja 2/2', date: '2026-10-10' }),
    ], TODAY);
    expect(compra.chargedInstallments).toBe(1);
  });

  it('separa compras na mesma loja com número de parcelas diferente', () => {
    const compras = groupInstallmentPurchases([
      tx({ name: '99 FOOD 3/4', date: '2026-09-21', amount: -11.41 }),
      tx({ name: '99 FOOD 5/6', date: '2026-10-23', amount: -18.68 }),
    ], TODAY);
    expect(compras.map(p => p.totalInstallments).sort()).toEqual([4, 6]);
  });

  it('separa compras iguais feitas em meses diferentes pelo mês de início', () => {
    const compras = groupInstallmentPurchases([
      tx({ name: 'Loja 1/3', date: '2026-08-05', amount: -30 }),
      tx({ name: 'Loja 1/3', date: '2026-09-05', amount: -30 }),
    ], TODAY);
    expect(compras).toHaveLength(2);
  });

  it('separa duas compras iguais no mesmo mês pela parcela repetida, mantendo cada valor no seu trilho', () => {
    const compras = groupInstallmentPurchases([
      tx({ name: 'Loja 1/2', date: '2026-09-05', amount: -100 }),
      tx({ name: 'Loja 1/2', date: '2026-09-05', amount: -40 }),
      tx({ name: 'Loja 2/2', date: '2026-10-05', amount: -40 }),
      tx({ name: 'Loja 2/2', date: '2026-10-05', amount: -100 }),
    ], TODAY);
    expect(compras).toHaveLength(2);
    expect(compras.map(p => p.totalAmount).sort((a, b) => a - b)).toEqual([80, 200]);
  });

  it('não junta parcelas de cartões diferentes', () => {
    const compras = groupInstallmentPurchases([
      tx({ name: 'Loja 1/2', date: '2026-09-05', accountId: 'cartao-a' }),
      tx({ name: 'Loja 2/2', date: '2026-10-05', accountId: 'cartao-b' }),
    ], TODAY);
    expect(compras).toHaveLength(2);
  });

  it('ignora compras à vista, estornos e transações da conta corrente', () => {
    expect(groupInstallmentPurchases([
      tx({ name: 'Amazon BR VI' }),
      tx({ name: 'Estorno Loja 2/5', amount: 30 }),
      tx({ name: 'Transferência 1/2', paymentType: 'debit' }),
    ], TODAY)).toEqual([]);
  });

  it('ajusta o dia da parcela estimada ao tamanho do mês (31 → 30)', () => {
    const [compra] = groupInstallmentPurchases([tx({ name: 'Loja 2/2', date: '2026-10-31' })], TODAY);
    expect(compra.installments[0].date).toBe('2026-09-30');
  });

  it('compra com todas as parcelas lançadas fica concluída e vai para o fim da lista', () => {
    const compras = groupInstallmentPurchases([
      tx({ name: 'Antiga 3/3', date: '2026-08-21' }),
      tx({ name: 'Nova 1/2', date: '2026-09-20' }),
    ], TODAY);
    expect(compras.map(p => p.name)).toEqual(['Nova', 'Antiga']);
    expect(compras[1].nextDate).toBeNull();
    expect(compras[1].remainingAmount).toBe(0);
  });

  it('usa um nome genérico quando a descrição é só o sufixo', () => {
    const [compra] = groupInstallmentPurchases([tx({ name: 'PARC 03/10', date: '2026-10-01' })], TODAY);
    expect(compra.name).toBe('Compra parcelada');
  });
});

describe('dueItemsInMonth', () => {
  const compras = groupInstallmentPurchases([
    tx({ name: 'Loja 1/2', date: '2026-09-20', amount: -50 }),
    tx({ name: 'Loja 2/2', date: '2026-10-20', amount: -50 }),
  ], TODAY);

  it('traz as parcelas de cartão e de dívida do mês, em ordem de data', () => {
    const items = dueItemsInMonth(compras, [debt({ nextDueDate: '2026-09-15' })], '2026-09');
    expect(items.map(i => [i.source, i.date, i.amount])).toEqual([
      ['debt', '2026-09-15', 250],
      ['card', '2026-09-20', 50],
    ]);
  });

  it('devolve lista vazia para um mês sem parcelas', () => {
    expect(dueItemsInMonth(compras, [], '2026-12')).toEqual([]);
  });

  it('das dívidas entram só as parcelas que ainda faltam pagar', () => {
    // 2 de 4 já pagas: as restantes vencem em setembro e outubro; agosto não tem o que mostrar.
    const d = debt({ paidInstallments: 2, paidAmount: 500, nextDueDate: '2026-09-15' });
    expect(dueItemsInMonth([], [d], '2026-08')).toEqual([]);
    expect(dueItemsInMonth([], [d], '2026-10').map(i => i.number)).toEqual([4]);
  });

  it('dívida quitada não aparece', () => {
    expect(dueItemsInMonth([], [debt({ paidInstallments: 4, paidAmount: 1000 })], '2026-09')).toEqual([]);
  });

  it('marca a parcela de cartão deduzida como estimada', () => {
    const r = groupInstallmentPurchases([tx({ name: 'Loja 2/2', date: '2026-10-20' })], TODAY);
    const [item] = dueItemsInMonth(r, [], '2026-09');
    expect(item.estimated).toBe(true);
  });
});

describe('summarizeDueItems', () => {
  it('separa cartão de dívida e soma o valor total do mês, sem ruído de ponto flutuante', () => {
    const compras = groupInstallmentPurchases([
      tx({ name: 'A 1/2', date: '2026-09-20', amount: -0.1 }),
      tx({ name: 'B 1/2', date: '2026-09-21', amount: -0.2 }),
    ], TODAY);
    const totals = summarizeDueItems(dueItemsInMonth(compras, [debt()], '2026-09'));
    expect(totals).toEqual({ card: 0.3, debt: 250, total: 250.3, count: 3 });
  });

  it('devolve zeros para um mês vazio', () => {
    expect(summarizeDueItems([])).toEqual({ card: 0, debt: 0, total: 0, count: 0 });
  });
});

describe('dueMonths', () => {
  it('reúne os meses de cartão e de dívida, do mais recente ao mais antigo, com o mês corrente', () => {
    const compras = groupInstallmentPurchases([tx({ name: 'Loja 2/2', date: '2026-11-20' })], TODAY);
    const d = debt({ totalInstallments: 1, totalAmount: 250, nextDueDate: '2027-01-15' });
    expect(dueMonths(compras, [d], '2026-09')).toEqual(['2027-01', '2026-11', '2026-10', '2026-09']);
  });
});
