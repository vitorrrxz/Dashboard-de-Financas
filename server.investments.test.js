// @vitest-environment node
// FIN-071 — CRUD, validação do vínculo com a conta e isolamento por usuário das rotas
// /api/investments (FIN-070).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from './test/backend-test-utils.js';

describe('/api/investments', () => {
  let app;
  let cleanup;
  let tokenA;
  let tokenB;
  let brokerA;   // conta de investimento de A
  let cardA;     // cartão de crédito de A
  let accountB;  // conta corrente de B

  const auth = token => ({ Authorization: `Bearer ${token}` });
  const validBody = { name: 'CDB', type: 'fixed_income', amountInvested: 100000, currentValue: 100000 };

  async function createAccount(token, body) {
    const res = await request(app).post('/api/accounts').set(auth(token))
      .send({ bank: 'Banco', balance: 0, color: '#6366f1', ...body });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    return res.body.id;
  }

  async function createInvestment(token, body = {}) {
    const res = await request(app).post('/api/investments').set(auth(token)).send({ ...validBody, ...body });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    return res.body;
  }

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('investments'));

    const regA = await request(app).post('/api/auth/register')
      .send({ name: 'Usuario A', email: 'usera@investments.test', password: 'senha123' });
    expect(regA.status).toBe(200);
    tokenA = regA.body.token;

    const regB = await request(app).post('/api/auth/register')
      .send({ name: 'Usuario B', email: 'userb@investments.test', password: 'senha123' });
    expect(regB.status).toBe(200);
    tokenB = regB.body.token;

    brokerA = await createAccount(tokenA, { name: 'XP', type: 'investment', balance: 500000 });
    cardA = await createAccount(tokenA, { name: 'Nubank', type: 'credit' });
    accountB = await createAccount(tokenB, { name: 'Conta de B', type: 'checking', balance: 1000 });
  });

  afterAll(() => cleanup());

  it('exige autenticação', async () => {
    const res = await request(app).get('/api/investments');
    expect(res.status).toBe(401);
  });

  it('cria uma posição com dados válidos, em centavos e sem conta vinculada', async () => {
    const res = await request(app).post('/api/investments').set(auth(tokenA))
      .send({ name: 'Tesouro Selic 2029', type: 'fixed_income', amountInvested: 250000, currentValue: 263450 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Tesouro Selic 2029', type: 'fixed_income', amountInvested: 250000, currentValue: 263450, accountId: null,
    });
    expect(res.body.updatedAt).toBeDefined();
  });

  it('aceita zero nos dois valores (posição sem custo, posição que perdeu tudo)', async () => {
    const bonus = await createInvestment(tokenA, { name: 'Bonificação', type: 'stocks', amountInvested: 0, currentValue: 12000 });
    expect(bonus.amountInvested).toBe(0);
    const lost = await createInvestment(tokenA, { name: 'Ação que virou pó', type: 'stocks', amountInvested: 50000, currentValue: 0 });
    expect(lost.currentValue).toBe(0);
  });

  it('vincula a posição a uma conta do próprio usuário', async () => {
    const created = await createInvestment(tokenA, { name: 'Fundo XP', type: 'funds', accountId: brokerA });
    expect(created.accountId).toBe(brokerA);
  });

  it.each([
    ['valor aplicado negativo', { amountInvested: -1 }],
    ['valor atual negativo', { currentValue: -100 }],
    ['valor em reais em vez de centavos', { amountInvested: 1500.5 }],
    ['valor atual ausente', { currentValue: undefined }],
    ['tipo fora da lista', { type: 'bonds' }],
    ['nome só com espaços', { name: '   ' }],
  ])('rejeita %s', async (_label, override) => {
    const res = await request(app).post('/api/investments').set(auth(tokenA)).send({ ...validBody, ...override });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('rejeita vínculo com cartão de crédito', async () => {
    const res = await request(app).post('/api/investments').set(auth(tokenA)).send({ ...validBody, accountId: cardA });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cartão/);
  });

  it('rejeita vínculo com conta de outro usuário — e não cria nada', async () => {
    const before = await request(app).get('/api/investments').set(auth(tokenA));
    expect(before.status).toBe(200);

    const res = await request(app).post('/api/investments').set(auth(tokenA)).send({ ...validBody, accountId: accountB });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/não encontrada/);

    const after = await request(app).get('/api/investments').set(auth(tokenA));
    expect(after.body).toHaveLength(before.body.length);
  });

  it('atualiza só o valor atual e devolve o registro com updatedAt novo', async () => {
    const created = await createInvestment(tokenA, { name: 'PETR4', type: 'stocks' });
    // Garante um instante diferente do da criação, para a comparação de updatedAt valer.
    await new Promise(resolve => setTimeout(resolve, 25));

    const res = await request(app).put(`/api/investments/${created.id}`).set(auth(tokenA)).send({ currentValue: 112000 });
    expect(res.status).toBe(200);
    expect(res.body.currentValue).toBe(112000);
    expect(res.body.amountInvested).toBe(100000); // update parcial não mexe no resto
    expect(res.body.name).toBe('PETR4');
    expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThan(new Date(created.updatedAt).getTime());
  });

  it('desfaz o vínculo com a conta quando accountId vem vazio', async () => {
    const created = await createInvestment(tokenA, { name: 'LCI', accountId: brokerA });
    expect(created.accountId).toBe(brokerA);

    const res = await request(app).put(`/api/investments/${created.id}`).set(auth(tokenA)).send({ accountId: '' });
    expect(res.status).toBe(200);
    expect(res.body.accountId).toBeNull();
  });

  it('não aceita, na edição, vínculo com cartão — e mantém o vínculo anterior', async () => {
    const created = await createInvestment(tokenA, { name: 'CDB edição', accountId: brokerA });
    const res = await request(app).put(`/api/investments/${created.id}`).set(auth(tokenA)).send({ accountId: cardA });
    expect(res.status).toBe(400);

    const list = await request(app).get('/api/investments').set(auth(tokenA));
    expect(list.body.find(i => i.id === created.id).accountId).toBe(brokerA);
  });

  it('PUT em id inexistente devolve 404', async () => {
    const res = await request(app).put('/api/investments/nao-existe').set(auth(tokenA)).send({ currentValue: 1 });
    expect(res.status).toBe(404);
  });

  it('excluir a conta desfaz o vínculo, mas a posição continua na carteira', async () => {
    const broker = await createAccount(tokenA, { name: 'Corretora temporária', type: 'investment' });
    const created = await createInvestment(tokenA, { name: 'Posição na corretora', accountId: broker });
    expect(created.accountId).toBe(broker);

    const del = await request(app).delete(`/api/accounts/${broker}`).set(auth(tokenA));
    expect(del.status).toBe(200);

    const list = await request(app).get('/api/investments').set(auth(tokenA));
    const kept = list.body.find(i => i.id === created.id);
    expect(kept).toBeDefined();
    expect(kept.accountId).toBeNull();
  });

  it('exclui a própria posição', async () => {
    const created = await createInvestment(tokenA, { name: 'Para excluir' });
    const del = await request(app).delete(`/api/investments/${created.id}`).set(auth(tokenA));
    expect(del.status).toBe(200);

    const list = await request(app).get('/api/investments').set(auth(tokenA));
    expect(list.body.find(i => i.id === created.id)).toBeUndefined();
  });

  it('lista na ordem de cadastro', async () => {
    const list = await request(app).get('/api/investments').set(auth(tokenA));
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThan(1);
    const times = list.body.map(i => new Date(i.createdAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  describe('isolamento entre usuários', () => {
    let investmentId;

    beforeAll(async () => {
      investmentId = (await createInvestment(tokenA, { name: 'Posição de A', currentValue: 300000 })).id;
    });

    it('B não vê a posição de A', async () => {
      const res = await request(app).get('/api/investments').set(auth(tokenB));
      expect(res.status).toBe(200);
      expect(res.body.find(i => i.id === investmentId)).toBeUndefined();
    });

    it('B não edita a posição de A (404, sem revelar que ela existe)', async () => {
      const res = await request(app).put(`/api/investments/${investmentId}`).set(auth(tokenB)).send({ currentValue: 1 });
      expect(res.status).toBe(404);

      const check = await request(app).get('/api/investments').set(auth(tokenA));
      expect(check.body.find(i => i.id === investmentId).currentValue).toBe(300000);
    });

    it('B não exclui a posição de A', async () => {
      await request(app).delete(`/api/investments/${investmentId}`).set(auth(tokenB));
      const check = await request(app).get('/api/investments').set(auth(tokenA));
      expect(check.body.find(i => i.id === investmentId)).toBeDefined();
    });
  });
});
