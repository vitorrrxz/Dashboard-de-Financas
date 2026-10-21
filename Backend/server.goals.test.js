// @vitest-environment node
// FIN-052 (parte 2/2) — CRUD e isolamento por usuário das rotas /api/goals (FIN-050).
// FIN-113 — vínculo (opcional, nunca os dois) com conta ou investimento.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from './test/backend-test-utils.js';

describe('/api/goals', () => {
  let app;
  let cleanup;
  let tokenA;
  let tokenB;
  let checkingA;   // conta corrente de A
  let cardA;       // cartão de crédito de A
  let investmentA; // posição de A
  let accountB;    // conta de B

  const auth = token => ({ Authorization: `Bearer ${token}` });

  async function createAccount(token, body) {
    const res = await request(app).post('/api/accounts').set(auth(token))
      .send({ bank: 'Banco', balance: 0, color: '#6366f1', ...body });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    return res.body.id;
  }

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('goals'));

    const regA = await request(app).post('/api/auth/register')
      .send({ name: 'Usuario A', email: 'usera@goals.test', password: 'senha123' });
    expect(regA.status).toBe(200);
    tokenA = regA.body.token;

    const regB = await request(app).post('/api/auth/register')
      .send({ name: 'Usuario B', email: 'userb@goals.test', password: 'senha123' });
    expect(regB.status).toBe(200);
    tokenB = regB.body.token;

    checkingA = await createAccount(tokenA, { name: 'Poupança A', type: 'savings', balance: 500000 });
    cardA = await createAccount(tokenA, { name: 'Cartão A', type: 'credit' });
    accountB = await createAccount(tokenB, { name: 'Conta de B', type: 'checking', balance: 1000 });

    const inv = await request(app).post('/api/investments').set(auth(tokenA))
      .send({ name: 'Tesouro A', type: 'fixed_income', amountInvested: 100000, currentValue: 110000 });
    expect(inv.status).toBe(200);
    investmentA = inv.body.id;
  });

  afterAll(() => cleanup());

  it('cria uma meta com dados válidos, começando com 0 acumulado', async () => {
    const res = await request(app).post('/api/goals').set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Reserva de emergência', targetAmount: 1000000, targetDate: '2027-12-31' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.targetAmount).toBe(1000000);
    expect(res.body.currentAmount).toBe(0);
  });

  it('aceita valor acumulado inicial explícito', async () => {
    const res = await request(app).post('/api/goals').set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Viagem', targetAmount: 500000, currentAmount: 120000, targetDate: '2027-06-30' });
    expect(res.status).toBe(200);
    expect(res.body.currentAmount).toBe(120000);
  });

  it('rejeita meta com valor-alvo <= 0', async () => {
    const res = await request(app).post('/api/goals').set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Meta inválida', targetAmount: 0, targetDate: '2027-12-31' });
    expect(res.status).toBe(400);
  });

  it('rejeita valor acumulado negativo', async () => {
    const res = await request(app).post('/api/goals').set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Meta inválida', targetAmount: 1000, currentAmount: -50, targetDate: '2027-12-31' });
    expect(res.status).toBe(400);
  });

  it('rejeita data-alvo fora do formato YYYY-MM-DD', async () => {
    const res = await request(app).post('/api/goals').set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Meta inválida', targetAmount: 1000, targetDate: '31/12/2027' });
    expect(res.status).toBe(400);
  });

  it('rejeita nome vazio', async () => {
    const res = await request(app).post('/api/goals').set('Authorization', `Bearer ${tokenA}`)
      .send({ name: '   ', targetAmount: 1000, targetDate: '2027-12-31' });
    expect(res.status).toBe(400);
  });

  it('atualiza o valor acumulado (aporte) da própria meta', async () => {
    const created = await request(app).post('/api/goals').set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Notebook', targetAmount: 800000, targetDate: '2027-03-01' });
    expect(created.status).toBe(200);

    const res = await request(app).put(`/api/goals/${created.body.id}`).set('Authorization', `Bearer ${tokenA}`)
      .send({ currentAmount: 200000 });
    expect(res.status).toBe(200);
    expect(res.body.changes).toBe(1);

    const list = await request(app).get('/api/goals').set('Authorization', `Bearer ${tokenA}`);
    expect(list.body.find(g => g.id === created.body.id).currentAmount).toBe(200000);
  });

  describe('vínculo com conta ou investimento (FIN-113)', () => {
    it('cria ligada a uma conta', async () => {
      const res = await request(app).post('/api/goals').set(auth(tokenA))
        .send({ name: 'Reserva', targetAmount: 1000000, targetDate: '2027-01-01', accountId: checkingA });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ accountId: checkingA, investmentId: null });
    });

    it('cria ligada a um investimento', async () => {
      const res = await request(app).post('/api/goals').set(auth(tokenA))
        .send({ name: 'Aposentadoria', targetAmount: 2000000, targetDate: '2030-01-01', investmentId: investmentA });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ investmentId: investmentA, accountId: null });
    });

    it('rejeita ligar aos dois ao mesmo tempo — e não cria nada', async () => {
      const before = await request(app).get('/api/goals').set(auth(tokenA));
      const res = await request(app).post('/api/goals').set(auth(tokenA))
        .send({ name: 'Inválida', targetAmount: 1000, targetDate: '2027-01-01', accountId: checkingA, investmentId: investmentA });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/uma conta OU a um investimento/);
      const after = await request(app).get('/api/goals').set(auth(tokenA));
      expect(after.body).toHaveLength(before.body.length);
    });

    it('rejeita vínculo com cartão de crédito', async () => {
      const res = await request(app).post('/api/goals').set(auth(tokenA))
        .send({ name: 'Inválida', targetAmount: 1000, targetDate: '2027-01-01', accountId: cardA });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cartão/);
    });

    it('rejeita vínculo com conta de outro usuário', async () => {
      const res = await request(app).post('/api/goals').set(auth(tokenA))
        .send({ name: 'Inválida', targetAmount: 1000, targetDate: '2027-01-01', accountId: accountB });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/não encontrada/);
    });

    it('rejeita vínculo com investimento inexistente', async () => {
      const res = await request(app).post('/api/goals').set(auth(tokenA))
        .send({ name: 'Inválida', targetAmount: 1000, targetDate: '2027-01-01', investmentId: 'nao-existe' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/não encontrado/);
    });

    it('trocar para um investimento desliga o vínculo anterior com a conta', async () => {
      const created = await request(app).post('/api/goals').set(auth(tokenA))
        .send({ name: 'Troca de vínculo', targetAmount: 1000, targetDate: '2027-01-01', accountId: checkingA });
      expect(created.body.accountId).toBe(checkingA);

      const res = await request(app).put(`/api/goals/${created.body.id}`).set(auth(tokenA)).send({ investmentId: investmentA });
      expect(res.status).toBe(200);
      expect(res.body.changes).toBe(1);

      const list = await request(app).get('/api/goals').set(auth(tokenA));
      const goal = list.body.find(g => g.id === created.body.id);
      expect(goal).toMatchObject({ investmentId: investmentA, accountId: null });
    });

    it('accountId vazio desliga o vínculo — meta volta ao modo manual', async () => {
      const created = await request(app).post('/api/goals').set(auth(tokenA))
        .send({ name: 'Volta ao manual', targetAmount: 1000, targetDate: '2027-01-01', accountId: checkingA });

      const res = await request(app).put(`/api/goals/${created.body.id}`).set(auth(tokenA)).send({ accountId: '' });
      expect(res.status).toBe(200);

      const list = await request(app).get('/api/goals').set(auth(tokenA));
      expect(list.body.find(g => g.id === created.body.id).accountId).toBeNull();
    });

    it('excluir a conta ligada desfaz o vínculo, mas a meta continua — com o último valor', async () => {
      const account = await createAccount(tokenA, { name: 'Conta temporária', type: 'savings', balance: 700000 });
      const created = await request(app).post('/api/goals').set(auth(tokenA))
        .send({ name: 'Meta com conta temporária', targetAmount: 1000000, currentAmount: 700000, targetDate: '2027-01-01', accountId: account });
      expect(created.body.accountId).toBe(account);

      const del = await request(app).delete(`/api/accounts/${account}`).set(auth(tokenA));
      expect(del.status).toBe(200);

      const list = await request(app).get('/api/goals').set(auth(tokenA));
      const goal = list.body.find(g => g.id === created.body.id);
      expect(goal).toBeDefined();
      expect(goal.accountId).toBeNull();
      expect(goal.currentAmount).toBe(700000); // último valor, não zerado
    });

    it('excluir o investimento ligado desfaz o vínculo, mas a meta continua', async () => {
      const inv = await request(app).post('/api/investments').set(auth(tokenA))
        .send({ name: 'Investimento temporário', type: 'stocks', amountInvested: 50000, currentValue: 60000 });
      expect(inv.status).toBe(200);
      const created = await request(app).post('/api/goals').set(auth(tokenA))
        .send({ name: 'Meta com investimento temporário', targetAmount: 100000, currentAmount: 60000, targetDate: '2027-01-01', investmentId: inv.body.id });
      expect(created.body.investmentId).toBe(inv.body.id);

      const del = await request(app).delete(`/api/investments/${inv.body.id}`).set(auth(tokenA));
      expect(del.status).toBe(200);

      const list = await request(app).get('/api/goals').set(auth(tokenA));
      const goal = list.body.find(g => g.id === created.body.id);
      expect(goal).toBeDefined();
      expect(goal.investmentId).toBeNull();
      expect(goal.currentAmount).toBe(60000);
    });
  });

  describe('isolamento entre usuários', () => {
    let goalId;

    beforeAll(async () => {
      const res = await request(app).post('/api/goals').set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Meta de A', targetAmount: 300000, targetDate: '2027-01-01' });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      goalId = res.body.id;
    });

    it('usuário B não vê a meta de A na listagem', async () => {
      const res = await request(app).get('/api/goals').set('Authorization', `Bearer ${tokenB}`);
      expect(res.body.find(g => g.id === goalId)).toBeUndefined();
    });

    it('usuário B não consegue editar a meta de A (no-op, não erro)', async () => {
      const res = await request(app).put(`/api/goals/${goalId}`).set('Authorization', `Bearer ${tokenB}`)
        .send({ currentAmount: 999999 });
      expect(res.status).toBe(200);
      expect(res.body.changes).toBe(0);

      const check = await request(app).get('/api/goals').set('Authorization', `Bearer ${tokenA}`);
      expect(check.body.find(g => g.id === goalId).currentAmount).toBe(0);
    });

    it('usuário B não consegue excluir a meta de A', async () => {
      await request(app).delete(`/api/goals/${goalId}`).set('Authorization', `Bearer ${tokenB}`);
      const check = await request(app).get('/api/goals').set('Authorization', `Bearer ${tokenA}`);
      expect(check.body.find(g => g.id === goalId)).toBeDefined();
    });
  });

  it('exige autenticação', async () => {
    const res = await request(app).get('/api/goals');
    expect(res.status).toBe(401);
  });
});
