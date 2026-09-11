// @vitest-environment node
// FIN-092 — normalização do sinal das transações de cartão vindas da Pluggy.
// FIN-095 — compras em moeda estrangeira: valor na moeda da conta.
// FIN-074 — moeda da conta vinda da Pluggy.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp } from './test/backend-test-utils.js';

describe('pluggyAmountToCents / isCreditCardBillPayment (FIN-092)', () => {
  let pluggyAmountToCents;
  let isCreditCardBillPayment;
  let pluggyCurrency;
  let cleanup;

  beforeAll(async () => {
    const app = await createTestApp('pluggy_credit');
    cleanup = app.cleanup;
    ({ pluggyAmountToCents, isCreditCardBillPayment, pluggyCurrency } = await import('./server.js'));
  });

  afterAll(() => cleanup());

  describe('conta de cartão (o referencial da Pluggy é a fatura, não o bolso)', () => {
    it('compra vem positiva da Pluggy e é gravada como despesa', () => {
      expect(pluggyAmountToCents({ amount: 147.89 }, 'credit')).toBe(-14789);
    });

    it('parcela futura também vira despesa — era ela que aparecia como receita', () => {
      expect(pluggyAmountToCents({ amount: 13.6 }, 'credit')).toBe(-1360);
    });

    it('crédito na fatura (estorno) vem negativo e é gravado como entrada', () => {
      expect(pluggyAmountToCents({ amount: -50 }, 'credit')).toBe(5000);
    });
  });

  describe('conta bancária (a Pluggy já usa a convenção do app)', () => {
    it('preserva o sinal negativo de uma saída', () => {
      expect(pluggyAmountToCents({ amount: -35.49 }, 'checking')).toBe(-3549);
    });

    it('preserva o sinal positivo de uma entrada', () => {
      expect(pluggyAmountToCents({ amount: 1200 }, 'savings')).toBe(120000);
    });
  });

  it('arredonda para o centavo mais próximo, sem acumular erro de ponto flutuante', () => {
    // 0.1 + 0.2 em float dá 0.30000000000000004; o valor gravado tem de ser 30 centavos.
    expect(pluggyAmountToCents({ amount: 0.1 + 0.2 }, 'credit')).toBe(-30);
  });

  it('zero não ganha sinal negativo', () => {
    expect(Object.is(pluggyAmountToCents({ amount: 0 }, 'credit'), -0)).toBe(false);
  });

  describe('compra em moeda estrangeira (FIN-095)', () => {
    it('grava o valor da fatura (moeda da conta), e não o da compra em dólar', () => {
      // US$ 10 que entraram na fatura como R$ 54,30: antes, o app gravava −R$ 10,00.
      expect(pluggyAmountToCents({ amount: 10, amountInAccountCurrency: 54.3 }, 'credit')).toBe(-5430);
    });

    it('o sinal continua vindo de `amount`, mesmo que o outro campo venha com sinal trocado', () => {
      expect(pluggyAmountToCents({ amount: -10, amountInAccountCurrency: 54.3 }, 'credit')).toBe(5430);
      expect(pluggyAmountToCents({ amount: -10, amountInAccountCurrency: -54.3 }, 'credit')).toBe(5430);
      expect(pluggyAmountToCents({ amount: 10, amountInAccountCurrency: -54.3 }, 'credit')).toBe(-5430);
    });

    it('sem valor na moeda da conta (compra em real), usa `amount` como sempre', () => {
      expect(pluggyAmountToCents({ amount: 25, amountInAccountCurrency: null }, 'credit')).toBe(-2500);
      expect(pluggyAmountToCents({ amount: -25 }, 'checking')).toBe(-2500);
    });

    it('um valor que não é número finito é ignorado', () => {
      expect(pluggyAmountToCents({ amount: 25, amountInAccountCurrency: '54.30' }, 'credit')).toBe(-2500);
      expect(pluggyAmountToCents({ amount: 25, amountInAccountCurrency: Number.NaN }, 'credit')).toBe(-2500);
    });
  });

  describe('pluggyCurrency (FIN-074)', () => {
    it('usa o código ISO que a Pluggy informa', () => {
      expect(pluggyCurrency('BRL')).toBe('BRL');
      expect(pluggyCurrency('USD')).toBe('USD');
    });

    it('um código válido fora da lista do app é gravado como veio', () => {
      expect(pluggyCurrency('ARS')).toBe('ARS');
    });

    it('código ausente ou fora do padrão cai em real', () => {
      expect(pluggyCurrency(undefined)).toBe('BRL');
      expect(pluggyCurrency(null)).toBe('BRL');
      expect(pluggyCurrency('usd')).toBe('BRL');
      expect(pluggyCurrency('US')).toBe('BRL');
      expect(pluggyCurrency(986)).toBe('BRL');
    });
  });

  describe('isCreditCardBillPayment', () => {
    it('reconhece o pagamento pela categoria normalizada da Pluggy', () => {
      expect(isCreditCardBillPayment({ category: 'Credit card payment', description: 'Pagamento recebido' })).toBe(true);
    });

    it('reconhece pela descrição quando a categoria vem vazia', () => {
      expect(isCreditCardBillPayment({ category: null, description: 'Pagamento de fatura' })).toBe(true);
    });

    it('não confunde uma compra com pagamento de fatura', () => {
      expect(isCreditCardBillPayment({ category: 'Groceries', description: 'Mercado*Mercadolivre 3/10' })).toBe(false);
    });

    it('não quebra quando categoria e descrição estão ausentes', () => {
      expect(isCreditCardBillPayment({})).toBe(false);
    });
  });
});
