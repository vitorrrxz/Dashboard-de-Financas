// @vitest-environment node
// FIN-074/FIN-075 — moedas no servidor: moeda derivada da conta, troca de moeda da conta,
// recorrências, notificações e a rota/cache de câmbio.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createTestApp } from './test/backend-test-utils.js';
import { SUPPORTED_CURRENCIES as FRONTEND_CURRENCIES } from './src/utils/currency.ts';

/** Data local em YYYY-MM-DD — a mesma convenção de `todayISO` no servidor. */
function localISO(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `YYYY-MM` do mês a `offset` meses do atual. */
function monthKey(offset) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return localISO(d).slice(0, 7);
}

describe('moedas no servidor (FIN-074/FIN-075)', () => {
  let app;
  let cleanup;
  let server;
  let tokenA;
  let tokenB;

  const auth = token => ({ Authorization: `Bearer ${token}` });

  async function register(name, email) {
    const res = await request(app).post('/api/auth/register').send({ name, email, password: 'senha123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    return res.body.token;
  }

  async function createAccount(token, body) {
    const res = await request(app).post('/api/accounts').set(auth(token))
      .send({ bank: 'Banco', type: 'checking', balance: 0, color: '#6366f1', ...body });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    return res.body;
  }

  async function importTransactions(token, transactions) {
    const res = await request(app).post('/api/transactions').set(auth(token)).send({ transactions });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(transactions.length);
  }

  async function listTransactions(token) {
    const res = await request(app).get('/api/transactions').set(auth(token));
    expect(res.status).toBe(200);
    return res.body;
  }

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('currency'));
    server = await import('./server.js');
    tokenA = await register('Usuario A', 'usera@currency.test');
    tokenB = await register('Usuario B', 'userb@currency.test');
  });

  afterAll(() => cleanup());
  afterEach(() => vi.restoreAllMocks());

  it('a lista de moedas do servidor é a mesma do frontend', () => {
    expect(server.SUPPORTED_CURRENCIES).toEqual([...FRONTEND_CURRENCIES]);
  });

  describe('contas', () => {
    it('conta nova nasce em real quando a moeda não é informada', async () => {
      const account = await createAccount(tokenA, { name: 'Itaú' });
      expect(account.currency).toBe('BRL');
    });

    it('aceita uma moeda da lista', async () => {
      const account = await createAccount(tokenA, { name: 'Wise', currency: 'USD' });
      expect(account.currency).toBe('USD');
    });

    it.each(['ARS', 'usd', 'DOLAR', ''])('rejeita a moeda %j', async currency => {
      const res = await request(app).post('/api/accounts').set(auth(tokenA))
        .send({ name: 'Conta', bank: 'Banco', type: 'checking', balance: 0, color: '#6366f1', currency });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Moeda/);
    });

    it('trocar a moeda da conta leva as transações dela junto, sem converter os valores', async () => {
      const account = await createAccount(tokenA, { name: 'Conta cadastrada errado' });
      await importTransactions(tokenA, [
        { name: 'Café em NY', category: 'Alimentação', date: '2026-09-01', amount: -500, accountId: account.id },
      ]);

      const put = await request(app).put(`/api/accounts/${account.id}`).set(auth(tokenA)).send({ currency: 'USD' });
      expect(put.status).toBe(200);
      expect(put.body.changes).toBe(1);

      const tx = (await listTransactions(tokenA)).find(t => t.accountId === account.id);
      expect(tx).toMatchObject({ currency: 'USD', amount: -500 });
    });

    it('B não consegue trocar a moeda da conta de A — nem das transações dela', async () => {
      const account = await createAccount(tokenA, { name: 'Conta de A' });
      await importTransactions(tokenA, [
        { name: 'Mercado', category: 'Alimentação', date: '2026-09-02', amount: -9000, accountId: account.id },
      ]);

      const put = await request(app).put(`/api/accounts/${account.id}`).set(auth(tokenB)).send({ currency: 'EUR' });
      expect(put.status).toBe(200);
      expect(put.body.changes).toBe(0);

      const tx = (await listTransactions(tokenA)).find(t => t.accountId === account.id);
      expect(tx.currency).toBe('BRL');
    });
  });

  describe('transações — a moeda é sempre a da conta', () => {
    it('importação herda a moeda da conta, e o cliente não consegue escolher outra', async () => {
      const usd = await createAccount(tokenA, { name: 'Conta em dólar', currency: 'USD' });
      await importTransactions(tokenA, [
        { name: 'Uber', category: 'Transporte', date: '2026-09-03', amount: -1500, accountId: usd.id, currency: 'EUR' },
      ]);
      const tx = (await listTransactions(tokenA)).find(t => t.name === 'Uber');
      expect(tx.currency).toBe('USD');
    });

    it('transação sem conta fica em real', async () => {
      const res = await request(app).post('/api/transactions').set(auth(tokenA))
        .send({ name: 'Dinheiro achado', category: 'Receita', date: '2026-09-04', amount: 2000, currency: 'USD' });
      expect(res.status).toBe(200);
      expect(res.body.currency).toBe('BRL');
    });

    it('mover a transação para uma conta em dólar troca a moeda; desvincular volta para real', async () => {
      const brl = await createAccount(tokenA, { name: 'Conta real' });
      const usd = await createAccount(tokenA, { name: 'Outra em dólar', currency: 'USD' });
      const created = await request(app).post('/api/transactions').set(auth(tokenA))
        .send({ name: 'Livro', category: 'Educação', date: '2026-09-05', amount: -4000, accountId: brl.id });
      expect(created.status).toBe(200);
      expect(created.body.currency).toBe('BRL');

      const moved = await request(app).put(`/api/transactions/${created.body.id}`).set(auth(tokenA)).send({ accountId: usd.id });
      expect(moved.status).toBe(200);
      expect((await listTransactions(tokenA)).find(t => t.id === created.body.id).currency).toBe('USD');

      const unlinked = await request(app).put(`/api/transactions/${created.body.id}`).set(auth(tokenA)).send({ accountId: '' });
      expect(unlinked.status).toBe(200);
      expect((await listTransactions(tokenA)).find(t => t.id === created.body.id).currency).toBe('BRL');
    });

    it('editar só o nome não mexe na moeda', async () => {
      const usd = await createAccount(tokenA, { name: 'Terceira em dólar', currency: 'USD' });
      const created = await request(app).post('/api/transactions').set(auth(tokenA))
        .send({ name: 'Almoço', category: 'Alimentação', date: '2026-09-06', amount: -2500, accountId: usd.id });
      expect(created.status).toBe(200);

      const res = await request(app).put(`/api/transactions/${created.body.id}`).set(auth(tokenA)).send({ name: 'Almoço de negócios' });
      expect(res.status).toBe(200);
      expect((await listTransactions(tokenA)).find(t => t.id === created.body.id).currency).toBe('USD');
    });

    // Até FIN-096 o vínculo era aceito e a transação ficava em real; agora a conta de outro usuário
    // é recusada antes de gravar — e continua sem emprestar a moeda dela.
    it('a conta de outro usuário não empresta a moeda dela: o vínculo é recusado (FIN-096)', async () => {
      const usdOfB = await createAccount(tokenB, { name: 'Dólar de B', currency: 'USD' });
      const res = await request(app).post('/api/transactions').set(auth(tokenA))
        .send({ name: 'Referência cruzada', category: 'Outros', date: '2026-09-07', amount: -100, accountId: usdOfB.id });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Conta vinculada não encontrada.');
      expect((await listTransactions(tokenA)).find(t => t.name === 'Referência cruzada')).toBeUndefined();
    });
  });

  it('a ocorrência de uma recorrência nasce na moeda da conta', async () => {
    const usd = await createAccount(tokenA, { name: 'Assinaturas em dólar', currency: 'USD' });
    const created = await request(app).post('/api/recurring-transactions').set(auth(tokenA)).send({
      name: 'Streaming em dólar', category: 'Lazer', amount: -1599, frequency: 'monthly',
      nextOccurrence: localISO(new Date()), accountId: usd.id,
    });
    expect(created.status).toBe(200);

    const processed = await request(app).post('/api/recurring-transactions/process').set(auth(tokenA));
    expect(processed.status).toBe(200);
    expect(processed.body.processed).toBeGreaterThanOrEqual(1);

    const tx = (await listTransactions(tokenA)).find(t => t.name === 'Streaming em dólar');
    expect(tx).toMatchObject({ currency: 'USD', amount: -1599 });
  });

  describe('notificações', () => {
    it('o aviso de fatura sai na moeda do cartão', () => {
      const [notification] = server.buildDueNotifications(
        [],
        [{ id: 'c1', name: 'Cartão global', type: 'credit', pendingBill: 10000, dueDay: 15, currency: 'USD' }],
        '2026-09-10',
        7
      );
      expect(notification.message).toBe('A fatura de US$ 100,00 vence em 15/09.');
    });

    it('formatCents usa o símbolo da moeda e cai no código ISO fora da lista', () => {
      expect(server.formatCents(123456, 'EUR')).toBe('€ 1.234,56');
      expect(server.formatCents(-500)).toBe('R$ 5,00');
      expect(server.formatCents(100000, 'ARS')).toBe('ARS 1.000,00');
      expect(server.formatCents(100, 'constructor')).toBe('constructor 1,00');
    });

    it('gasto em moeda estrangeira não entra no alerta de gasto incomum (e o mesmo gasto em real entra)', async () => {
      // Mesmo cenário para dois usuários; só a moeda da conta do gasto do mês muda. O usuário em
      // real prova que o cenário dispara o alerta — se o de dólar também disparasse, o filtro
      // por moeda não estaria funcionando.
      const today = localISO(new Date());
      const scenario = async (email, currency) => {
        const token = await register('Usuario ' + currency, email);
        const brl = await createAccount(token, { name: 'Conta corrente' });
        const spending = currency === 'BRL' ? brl : await createAccount(token, { name: 'Conta em ' + currency, currency });
        await importTransactions(token, [
          { name: 'Cinema', category: 'Lazer', date: `${monthKey(-2)}-01`, amount: -10000, accountId: brl.id },
          { name: 'Show', category: 'Lazer', date: `${monthKey(-1)}-10`, amount: -10000, accountId: brl.id },
          { name: 'Viagem', category: 'Lazer', date: today, amount: -100000, accountId: spending.id },
        ]);
        const generated = await request(app).post('/api/notifications/generate').set(auth(token));
        expect(generated.status).toBe(200);
        const list = await request(app).get('/api/notifications').set(auth(token));
        expect(list.status).toBe(200);
        return list.body.notifications.filter(n => n.type === 'unusual_spending');
      };

      expect(await scenario('real@currency.test', 'BRL')).toHaveLength(1);
      expect(await scenario('dolar@currency.test', 'USD')).toHaveLength(0);
    });
  });

  describe('parseProviderRates (FIN-075)', () => {
    it('inverte a cotação do provedor para reais por unidade', () => {
      expect(server.parseProviderRates({ amount: 1, base: 'BRL', date: '2026-09-10', rates: { USD: 0.2, EUR: 0.16 } }))
        .toEqual({ date: '2026-09-10', rates: { USD: 5, EUR: 6.25 } });
    });

    it('descarta, uma a uma, cotações que dariam divisão por zero ou valor sem sentido', () => {
      const r = server.parseProviderRates({ base: 'BRL', date: '2026-09-10', rates: { USD: 0.2, EUR: 0, GBP: -1, CHF: '0.2', usd: 0.2 } });
      expect(r.rates).toEqual({ USD: 5 });
    });

    it('resposta fora do formato vira null', () => {
      expect(server.parseProviderRates(null)).toBeNull();
      expect(server.parseProviderRates({ base: 'USD', date: '2026-09-10', rates: { BRL: 5 } })).toBeNull();
      expect(server.parseProviderRates({ base: 'BRL', date: 'ontem', rates: {} })).toBeNull();
      expect(server.parseProviderRates({ base: 'BRL', date: '2026-09-10', rates: [0.2] })).toBeNull();
    });
  });

  describe('createExchangeRateCache (FIN-075)', () => {
    const fresh = { date: '2026-09-10', rates: { USD: 5 } };
    let clock;
    const now = () => clock;

    function makeCache(fetchRates) {
      return server.createExchangeRateCache({ fetchRates, ttlMs: 1000, retryMs: 100, now });
    }

    it('consulta uma vez e serve do cache enquanto vale', async () => {
      clock = 0;
      const fetchRates = vi.fn().mockResolvedValue(fresh);
      const getRates = makeCache(fetchRates);
      expect(await getRates()).toEqual({ ...fresh, stale: false });
      clock = 999;
      expect(await getRates()).toEqual({ ...fresh, stale: false });
      expect(fetchRates).toHaveBeenCalledTimes(1);

      clock = 1000;
      await getRates();
      expect(fetchRates).toHaveBeenCalledTimes(2);
    });

    it('chamadas simultâneas compartilham a mesma consulta', async () => {
      clock = 0;
      let resolve;
      const fetchRates = vi.fn(() => new Promise(r => { resolve = r; }));
      const getRates = makeCache(fetchRates);
      const pending = [getRates(), getRates(), getRates()];
      await Promise.resolve(); // deixa a consulta começar
      await Promise.resolve();
      resolve(fresh);
      const results = await Promise.all(pending);
      expect(results.every(r => r.stale === false)).toBe(true);
      expect(fetchRates).toHaveBeenCalledTimes(1);
    });

    it('sem cotação nenhuma, a falha sobe — e não tenta de novo antes da espera', async () => {
      clock = 0;
      const fetchRates = vi.fn().mockRejectedValue(new Error('fora do ar'));
      const getRates = makeCache(fetchRates);
      await expect(getRates()).rejects.toThrow('fora do ar');
      clock = 50;
      await expect(getRates()).rejects.toThrow();
      expect(fetchRates).toHaveBeenCalledTimes(1);

      clock = 150;
      fetchRates.mockResolvedValueOnce(fresh);
      expect(await getRates()).toEqual({ ...fresh, stale: false });
      expect(fetchRates).toHaveBeenCalledTimes(2);
    });

    it('com cotação anterior, a falha na atualização serve a anterior marcada como antiga', async () => {
      clock = 0;
      const fetchRates = vi.fn().mockResolvedValueOnce(fresh).mockRejectedValue(new Error('fora do ar'));
      const getRates = makeCache(fetchRates);
      await getRates();

      clock = 1500; // cache vencido
      expect(await getRates()).toEqual({ ...fresh, stale: true });
      clock = 1550; // dentro da espera: nem tenta
      expect(await getRates()).toEqual({ ...fresh, stale: true });
      expect(fetchRates).toHaveBeenCalledTimes(2);
    });

    it('uma exceção síncrona do provedor segue o mesmo caminho de falha', async () => {
      clock = 0;
      const fetchRates = vi.fn(() => { throw new Error('síncrono'); });
      const getRates = makeCache(fetchRates);
      await expect(getRates()).rejects.toThrow('síncrono');
      clock = 150; // passada a espera, precisa tentar de novo (e não ficar preso na falha antiga)
      fetchRates.mockImplementationOnce(() => Promise.resolve(fresh));
      expect(await getRates()).toEqual({ ...fresh, stale: false });
    });
  });

  describe('GET /api/exchange-rates (FIN-075)', () => {
    beforeAll(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date());
    });
    afterAll(() => vi.useRealTimers());

    const providerResponse = () => new Response(
      JSON.stringify({ amount: 1, base: 'BRL', date: '2026-09-10', rates: { USD: 0.2, EUR: 0.16 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

    it('exige autenticação', async () => {
      const res = await request(app).get('/api/exchange-rates?symbols=USD');
      expect(res.status).toBe(401);
    });

    it.each([
      ['sem symbols', ''],
      ['código curto', '?symbols=US'],
      ['código inválido', '?symbols=USD,EURO'],
      ['moedas demais', '?symbols=' + Array.from({ length: 21 }, (_, i) => 'A' + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26))).join(',')],
    ])('rejeita pedido %s, sem consultar o provedor', async (_label, query) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const res = await request(app).get('/api/exchange-rates' + query).set(auth(tokenA));
      expect(res.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('provedor fora do ar e sem cotação guardada: 502, sem repassar a mensagem do provedor', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED 10.0.0.1:443'));
      const res = await request(app).get('/api/exchange-rates?symbols=USD').set(auth(tokenA));
      expect(res.status).toBe(502);
      expect(res.body.error).not.toMatch(/ECONNREFUSED/);
    });

    it('converte para reais por unidade, ignora moeda sem cotação e usa o cache', async () => {
      vi.setSystemTime(Date.now() + 6 * 60 * 1000); // passa a espera após a falha anterior
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(providerResponse());

      const res = await request(app).get('/api/exchange-rates?symbols=usd,EUR,XYZ,BRL').set(auth(tokenA));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ base: 'BRL', date: '2026-09-10', rates: { USD: 5, EUR: 6.25, BRL: 1 }, stale: false });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(String(fetchSpy.mock.calls[0][0])).toMatch(/\/latest\?base=BRL$/);

      const again = await request(app).get('/api/exchange-rates?symbols=USD').set(auth(tokenA));
      expect(again.body.rates).toEqual({ USD: 5 });
      expect(fetchSpy).toHaveBeenCalledTimes(1); // do cache
    });
  });
});
