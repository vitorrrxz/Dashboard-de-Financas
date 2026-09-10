// @vitest-environment node
// FIN-092 — normalização do sinal das transações de cartão vindas da Pluggy.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp } from './test/backend-test-utils.js';

describe('pluggyAmountToCents / isCreditCardBillPayment (FIN-092)', () => {
  let pluggyAmountToCents;
  let isCreditCardBillPayment;
  let cleanup;

  beforeAll(async () => {
    const app = await createTestApp('pluggy_credit');
    cleanup = app.cleanup;
    ({ pluggyAmountToCents, isCreditCardBillPayment } = await import('./server.js'));
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
