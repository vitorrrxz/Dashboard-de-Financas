// FIN-111 — detecção de assinaturas: agrupamento pelo nome normalizado, intervalo regular, valor
// estável, e as exclusões (já tem recorrência, descartada, menos de 3 ocorrências, receita).
import { describe, it, expect } from 'vitest';
import type { Transaction, RecurringTransaction } from '../types';
import {
  detectSubscriptions, normalizeSubscriptionName, monthlySubscriptionCost,
  readDismissedSubscriptions, dismissSubscription,
} from './subscriptions';

let nextId = 1;
/** Uma despesa mínima, só com os campos que a detecção usa. */
function expense(overrides: Partial<Transaction> & { name: string; date: string; amount: number }): Transaction {
  return { id: String(nextId++), category: 'Lazer', ...overrides };
}

describe('detectSubscriptions', () => {
  it('mensal com reajuste pequeno é detectada', () => {
    const transactions = [
      expense({ name: 'NETFLIX.COM', date: '2026-06-05', amount: -39.9 }),
      expense({ name: 'NETFLIX.COM', date: '2026-07-05', amount: -39.9 }),
      expense({ name: 'NETFLIX.COM', date: '2026-08-06', amount: -44.9 }), // reajuste ~12%, dentro da tolerância
    ];
    const [sub] = detectSubscriptions(transactions, []);
    expect(sub).toBeDefined();
    expect(sub.frequency).toBe('monthly');
    expect(sub.occurrences).toBe(3);
    expect(sub.amount).toBeLessThan(0);
    expect(sub.nextOccurrence).toBe('2026-09-06');
  });

  it('compras frequentes em datas irregulares não são detectadas', () => {
    const transactions = [
      expense({ name: 'PADARIA DO ZE', date: '2026-06-01', amount: -15 }),
      expense({ name: 'PADARIA DO ZE', date: '2026-06-04', amount: -12 }),
      expense({ name: 'PADARIA DO ZE', date: '2026-06-25', amount: -18 }),
      expense({ name: 'PADARIA DO ZE', date: '2026-07-20', amount: -14 }),
    ];
    expect(detectSubscriptions(transactions, [])).toEqual([]);
  });

  it('menos de 3 ocorrências não é detectada', () => {
    const transactions = [
      expense({ name: 'SPOTIFY', date: '2026-06-10', amount: -21.9 }),
      expense({ name: 'SPOTIFY', date: '2026-07-10', amount: -21.9 }),
    ];
    expect(detectSubscriptions(transactions, [])).toEqual([]);
  });

  it('reajuste grande demais (fora da tolerância) não é detectado', () => {
    const transactions = [
      expense({ name: 'ACADEMIA X', date: '2026-05-10', amount: -80 }),
      expense({ name: 'ACADEMIA X', date: '2026-06-10', amount: -80 }),
      expense({ name: 'ACADEMIA X', date: '2026-07-10', amount: -160 }), // dobrou — não é "reajuste pequeno"
    ];
    expect(detectSubscriptions(transactions, [])).toEqual([]);
  });

  it('semanal e anual também são reconhecidos', () => {
    const weekly = [
      expense({ name: 'FEIRA ORGANICA', date: '2026-06-01', amount: -50 }),
      expense({ name: 'FEIRA ORGANICA', date: '2026-06-08', amount: -50 }),
      expense({ name: 'FEIRA ORGANICA', date: '2026-06-15', amount: -52 }),
    ];
    const yearly = [
      expense({ name: 'SEGURO AUTO', date: '2024-03-01', amount: -1200 }),
      expense({ name: 'SEGURO AUTO', date: '2025-03-03', amount: -1200 }),
      expense({ name: 'SEGURO AUTO', date: '2026-03-02', amount: -1300 }),
    ];
    const found = detectSubscriptions([...weekly, ...yearly], []);
    expect(found.map(s => s.frequency).sort()).toEqual(['weekly', 'yearly']);
  });

  it('receita não entra na detecção (só despesas)', () => {
    const transactions = [
      expense({ name: 'SALARIO EMPRESA', date: '2026-06-05', amount: 5000, category: 'Receita' }),
      expense({ name: 'SALARIO EMPRESA', date: '2026-07-05', amount: 5000, category: 'Receita' }),
      expense({ name: 'SALARIO EMPRESA', date: '2026-08-05', amount: 5000, category: 'Receita' }),
    ];
    expect(detectSubscriptions(transactions, [])).toEqual([]);
  });

  it('transferência entre contas próprias e pagamento de fatura não entram', () => {
    const transactions = [
      expense({ name: 'PAGAMENTO CARTAO', date: '2026-06-05', amount: -500, category: 'Pagamento de fatura' }),
      expense({ name: 'PAGAMENTO CARTAO', date: '2026-07-05', amount: -500, category: 'Pagamento de fatura' }),
      expense({ name: 'PAGAMENTO CARTAO', date: '2026-08-05', amount: -500, category: 'Pagamento de fatura' }),
    ];
    expect(detectSubscriptions(transactions, [])).toEqual([]);
  });

  it('grupo que já tem recorrência cadastrada fica de fora, mesmo pausada', () => {
    const transactions = [
      expense({ name: 'Netflix', date: '2026-06-05', amount: -39.9 }),
      expense({ name: 'Netflix', date: '2026-07-05', amount: -39.9 }),
      expense({ name: 'Netflix', date: '2026-08-05', amount: -39.9 }),
    ];
    const recurring: RecurringTransaction[] = [{
      id: 'r1', name: 'netflix', category: 'Lazer', amount: -39.9,
      frequency: 'monthly', nextOccurrence: '2026-09-05', active: false, createdAt: '2026-06-01T00:00:00.000Z',
    }];
    expect(detectSubscriptions(transactions, recurring)).toEqual([]);
  });

  it('chave descartada fica de fora', () => {
    const transactions = [
      expense({ name: 'DISNEY PLUS', date: '2026-06-05', amount: -27.9 }),
      expense({ name: 'DISNEY PLUS', date: '2026-07-05', amount: -27.9 }),
      expense({ name: 'DISNEY PLUS', date: '2026-08-05', amount: -27.9 }),
    ];
    const dismissed = new Set([normalizeSubscriptionName('DISNEY PLUS')]);
    expect(detectSubscriptions(transactions, [], dismissed)).toEqual([]);
  });

  it('ordena as sugestões pela quantidade de ocorrências, da maior para a menor', () => {
    const three = [
      expense({ name: 'A', date: '2026-04-01', amount: -10 }),
      expense({ name: 'A', date: '2026-05-01', amount: -10 }),
      expense({ name: 'A', date: '2026-06-01', amount: -10 }),
    ];
    const four = [
      expense({ name: 'B', date: '2026-03-01', amount: -20 }),
      expense({ name: 'B', date: '2026-04-01', amount: -20 }),
      expense({ name: 'B', date: '2026-05-01', amount: -20 }),
      expense({ name: 'B', date: '2026-06-01', amount: -20 }),
    ];
    const found = detectSubscriptions([...three, ...four], []);
    expect(found.map(s => s.name)).toEqual(['B', 'A']);
  });
});

describe('detectSubscriptions — casos de borda', () => {
  it('gap de 24 dias (limite mínimo do mensal) é aceito', () => {
    const transactions = [
      expense({ name: 'X', date: '2026-01-01', amount: -10 }),
      expense({ name: 'X', date: '2026-01-25', amount: -10 }), // +24 dias
      expense({ name: 'X', date: '2026-02-18', amount: -10 }), // +24 dias
    ];
    expect(detectSubscriptions(transactions, [])[0]?.frequency).toBe('monthly');
  });

  it('gap de 23 dias (abaixo do limite mensal e acima do semanal) não bate com nenhuma frequência', () => {
    const transactions = [
      expense({ name: 'X', date: '2026-01-01', amount: -10 }),
      expense({ name: 'X', date: '2026-01-24', amount: -10 }), // +23 dias
      expense({ name: 'X', date: '2026-02-16', amount: -10 }), // +23 dias
    ];
    expect(detectSubscriptions(transactions, [])).toEqual([]);
  });

  it('valor exatamente na borda da tolerância (15% da mediana) ainda é estável', () => {
    const transactions = [
      expense({ name: 'X', date: '2026-01-01', amount: -100 }),
      expense({ name: 'X', date: '2026-02-01', amount: -100 }),
      expense({ name: 'X', date: '2026-03-01', amount: -115 }), // +15% exatos da mediana (100)
    ];
    expect(detectSubscriptions(transactions, [])).toHaveLength(1);
  });

  it('valor um centavo além da tolerância já não é estável', () => {
    const transactions = [
      expense({ name: 'X', date: '2026-01-01', amount: -100 }),
      expense({ name: 'X', date: '2026-02-01', amount: -100 }),
      expense({ name: 'X', date: '2026-03-01', amount: -115.01 }),
    ];
    expect(detectSubscriptions(transactions, [])).toEqual([]);
  });
});

describe('normalizeSubscriptionName', () => {
  it('ignora caixa, acento e espaços nas pontas/repetidos', () => {
    expect(normalizeSubscriptionName('  Nétflix   BR  ')).toBe('netflix br');
  });
});

describe('monthlySubscriptionCost', () => {
  it('mensal já é o próprio valor', () => {
    expect(monthlySubscriptionCost({ amount: -30, frequency: 'monthly' })).toBeCloseTo(30);
  });
  it('semanal multiplica por ~4,33 semanas/mês', () => {
    expect(monthlySubscriptionCost({ amount: -10, frequency: 'weekly' })).toBeCloseTo((10 * 52) / 12);
  });
  it('anual divide por 12', () => {
    expect(monthlySubscriptionCost({ amount: -1200, frequency: 'yearly' })).toBeCloseTo(100);
  });
});

describe('dismissed subscriptions (localStorage)', () => {
  /** Storage mínimo em memória — evita depender do jsdom global neste arquivo (`@vitest-environment node` implícito). */
  function memoryStorage(): Storage {
    const data = new Map<string, string>();
    return {
      getItem: k => data.get(k) ?? null,
      setItem: (k, v) => { data.set(k, v); },
      removeItem: k => { data.delete(k); },
      clear: () => data.clear(),
      key: () => null,
      get length() { return data.size; },
    };
  }

  it('sem nada salvo, o conjunto vem vazio', () => {
    expect(readDismissedSubscriptions(memoryStorage())).toEqual(new Set());
  });

  it('descartar persiste e soma às chaves já descartadas', () => {
    const storage = memoryStorage();
    dismissSubscription('netflix', storage);
    dismissSubscription('spotify', storage);
    expect(readDismissedSubscriptions(storage)).toEqual(new Set(['netflix', 'spotify']));
  });

  it('conteúdo corrompido no armazenamento não lança — volta vazio', () => {
    const storage = memoryStorage();
    storage.setItem('finflow_dismissed_subscriptions', '{not json');
    expect(readDismissedSubscriptions(storage)).toEqual(new Set());
  });

  it('armazenamento indisponível (lança ao ler/escrever) não quebra a chamada', () => {
    const broken: Storage = {
      getItem: () => { throw new Error('bloqueado'); },
      setItem: () => { throw new Error('bloqueado'); },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };
    expect(readDismissedSubscriptions(broken)).toEqual(new Set());
    expect(() => dismissSubscription('netflix', broken)).not.toThrow();
  });
});
