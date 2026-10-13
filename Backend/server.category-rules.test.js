// @vitest-environment node
// FIN-105 — regras de categoria do usuário: rotas (validação, edição pelo mesmo texto, isolamento)
// e aplicação na importação em lote. A aplicação no sync da Pluggy é testada em
// server.pluggy-credit.test.js (`pluggyTransactionCategory`), e o backup em server.backup.test.js.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from './test/backend-test-utils.js';

describe('regras de categoria (FIN-105)', () => {
  let app;
  let cleanup;
  let tokenA;
  let tokenB;
  const auth = token => ({ Authorization: `Bearer ${token}` });

  async function register(email) {
    const res = await request(app).post('/api/auth/register').send({ name: email, email, password: 'senha123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    return res.body.token;
  }

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('category_rules'));
    tokenA = await register('a@rules.test');
    tokenB = await register('b@rules.test');
  });

  afterAll(() => cleanup());

  it('cria, edita pelo mesmo texto, lista e exclui', async () => {
    const created = await request(app).post('/api/category-rules').set(auth(tokenA)).send({ match: ' Uber ', category: 'Transporte' });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ match: 'Uber', category: 'Transporte' });

    const edited = await request(app).post('/api/category-rules').set(auth(tokenA)).send({ match: 'Uber', category: 'Lazer' });
    expect(edited.status).toBe(200);
    expect(edited.body.id).toBe(created.body.id);

    const list = await request(app).get('/api/category-rules').set(auth(tokenA));
    expect(list.body).toEqual([expect.objectContaining({ id: created.body.id, match: 'Uber', category: 'Lazer' })]);

    const removed = await request(app).delete(`/api/category-rules/${created.body.id}`).set(auth(tokenA));
    expect(removed.status).toBe(200);
    expect((await request(app).get('/api/category-rules').set(auth(tokenA))).body).toEqual([]);
  });

  it('recusa texto curto demais, categoria vazia e corpo sem campos', async () => {
    for (const body of [{ match: 'a', category: 'Outros' }, { match: 'Uber', category: ' ' }, {}]) {
      const res = await request(app).post('/api/category-rules').set(auth(tokenA)).send(body);
      expect(res.status).toBe(400);
    }
    expect((await request(app).get('/api/category-rules').set(auth(tokenA))).body).toEqual([]);
  });

  it('isolamento: um usuário não vê nem exclui as regras de outro', async () => {
    const rule = await request(app).post('/api/category-rules').set(auth(tokenA)).send({ match: 'Padaria', category: 'Alimentação' });
    expect(rule.status).toBe(200);
    expect((await request(app).get('/api/category-rules').set(auth(tokenB))).body).toEqual([]);

    await request(app).delete(`/api/category-rules/${rule.body.id}`).set(auth(tokenB));
    const ofA = await request(app).get('/api/category-rules').set(auth(tokenA));
    expect(ofA.body.map(r => r.id)).toContain(rule.body.id);
  });

  it('a importação em lote usa a regra — sem acento, sem diferenciar maiúsculas, e a mais específica vence', async () => {
    for (const body of [{ match: 'posto', category: 'Transporte' }, { match: 'Posto Ipiranga Café', category: 'Alimentação' }]) {
      expect((await request(app).post('/api/category-rules').set(auth(tokenB)).send(body)).status).toBe(200);
    }
    const tx = (name, category) => ({ name, category, date: '2026-09-01', amount: -1000 });
    const res = await request(app).post('/api/transactions').set(auth(tokenB)).send({ transactions: [
      tx('POSTO SHELL 123', 'Outros'),
      // Chega com a categoria que a regra curta daria: só a regra mais longa explica "Alimentação".
      tx('POSTO IPIRANGA CAFE', 'Transporte'),
      tx('Mercado', 'Alimentação'),
    ] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);

    const list = await request(app).get('/api/transactions').set(auth(tokenB));
    expect(Object.fromEntries(list.body.map(t => [t.name, t.category]))).toEqual({
      'POSTO SHELL 123': 'Transporte', 'POSTO IPIRANGA CAFE': 'Alimentação', Mercado: 'Alimentação',
    });
  });

  it('aplicar às já gravadas recategoriza só onde esta regra vence, só do próprio usuário, e diz quantas mudaram (FIN-106)', async () => {
    const tokenC = await register('c@rules.test');
    const tx = (name, category) => ({ name, category, date: '2026-09-03', amount: -1500 });
    expect((await request(app).post('/api/transactions').set(auth(tokenC)).send({ transactions: [
      tx('UBER *TRIP', 'Outros'), tx('Uber Eats Pizza', 'Alimentação'), tx('Padaria', 'Outros'),
    ] })).status).toBe(200);
    // Uma transação de outro usuário que casaria com o texto: não pode mudar.
    expect((await request(app).post('/api/transactions').set(auth(tokenA)).send(tx('UBER de A', 'Outros'))).status).toBe(200);
    // Regra mais longa, de outra categoria, criada antes: "Uber Eats" continua Alimentação.
    expect((await request(app).post('/api/category-rules').set(auth(tokenC)).send({ match: 'uber eats', category: 'Alimentação' })).status).toBe(200);

    const res = await request(app).post('/api/category-rules').set(auth(tokenC)).send({ match: 'uber', category: 'Transporte', applyToExisting: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ match: 'uber', category: 'Transporte', updated: 1 });

    const ofC = await request(app).get('/api/transactions').set(auth(tokenC));
    expect(Object.fromEntries(ofC.body.map(t => [t.name, t.category]))).toEqual({
      'UBER *TRIP': 'Transporte', 'Uber Eats Pizza': 'Alimentação', Padaria: 'Outros',
    });
    const ofA = await request(app).get('/api/transactions').set(auth(tokenA));
    expect(ofA.body.find(t => t.name === 'UBER de A').category).toBe('Outros');
  });

  it('sem applyToExisting, nada já gravado muda', async () => {
    const tokenD = await register('d@rules.test');
    expect((await request(app).post('/api/transactions').set(auth(tokenD)).send({ name: 'Netflix', category: 'Outros', date: '2026-09-04', amount: -3990 })).status).toBe(200);
    const res = await request(app).post('/api/category-rules').set(auth(tokenD)).send({ match: 'netflix', category: 'Lazer' });
    expect(res.body.updated).toBe(0);
    expect((await request(app).get('/api/transactions').set(auth(tokenD))).body[0].category).toBe('Outros');
  });

  it('a transação criada à mão fica com a categoria escolhida, mesmo com uma regra que casa', async () => {
    const res = await request(app).post('/api/transactions').set(auth(tokenB)).send({ name: 'Posto Shell', category: 'Lazer', date: '2026-09-02', amount: -500 });
    expect(res.status).toBe(200);
    expect(res.body.category).toBe('Lazer');
  });
});
