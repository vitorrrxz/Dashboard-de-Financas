// @vitest-environment node
// FIN-112 — retrato mensal do patrimônio líquido: o mês corrente é atualizado a cada chamada, os
// meses anteriores nunca são tocados por esta rota, um registro por (usuário, mês), e isolamento.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from './test/backend-test-utils.js';

describe('/api/net-worth', () => {
  let app;
  let cleanup;
  let prisma;
  let tokenA;
  let tokenB;
  let userA;

  const auth = token => ({ Authorization: `Bearer ${token}` });
  const validBody = { liquid: 500000, investments: 200000, liabilities: 100000, total: 600000 };
  const currentMonth = new Date().toISOString().slice(0, 7);

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('networth'));
    ({ prisma } = await import('./server.js'));

    const regA = await request(app).post('/api/auth/register')
      .send({ name: 'Usuario A', email: 'usera@networth.test', password: 'senha123' });
    expect(regA.status).toBe(200);
    tokenA = regA.body.token;
    userA = regA.body.user.id;
    expect(userA).toEqual(expect.any(String));

    const regB = await request(app).post('/api/auth/register')
      .send({ name: 'Usuario B', email: 'userb@networth.test', password: 'senha123' });
    expect(regB.status).toBe(200);
    tokenB = regB.body.token;
  });

  afterAll(() => cleanup());

  it('exige autenticação nas duas rotas', async () => {
    expect((await request(app).post('/api/net-worth/snapshot').send(validBody)).status).toBe(401);
    expect((await request(app).get('/api/net-worth/history')).status).toBe(401);
  });

  it('cria o retrato do mês corrente', async () => {
    const res = await request(app).post('/api/net-worth/snapshot').set(auth(tokenA)).send(validBody);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ month: currentMonth, ...validBody });

    const history = await request(app).get('/api/net-worth/history').set(auth(tokenA));
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({ month: currentMonth, ...validBody });
  });

  it('chamado de novo no mesmo mês atualiza o registro em vez de duplicar', async () => {
    const updated = { liquid: 550000, investments: 210000, liabilities: 90000, total: 670000 };
    const res = await request(app).post('/api/net-worth/snapshot').set(auth(tokenA)).send(updated);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ month: currentMonth, ...updated });

    const history = await request(app).get('/api/net-worth/history').set(auth(tokenA));
    expect(history.body).toHaveLength(1); // ainda um registro só, não dois
    expect(history.body[0]).toMatchObject(updated);
  });

  it('mês passado, semeado direto no banco, não é tocado ao gravar o mês corrente', async () => {
    await prisma.netWorthSnapshot.create({
      data: { userId: userA, month: '2020-01', liquid: 1000, investments: 0, liabilities: 0, total: 1000 },
    });

    const res = await request(app).post('/api/net-worth/snapshot').set(auth(tokenA)).send(validBody);
    expect(res.status).toBe(200);

    const history = await request(app).get('/api/net-worth/history').set(auth(tokenA));
    expect(history.body).toHaveLength(2);
    const past = history.body.find(h => h.month === '2020-01');
    expect(past).toMatchObject({ liquid: 1000, investments: 0, liabilities: 0, total: 1000 });
  });

  it('devolve o histórico em ordem crescente de mês', async () => {
    const history = await request(app).get('/api/net-worth/history').set(auth(tokenA));
    const months = history.body.map(h => h.month);
    expect(months).toEqual([...months].sort());
  });

  it.each([
    ['total não bate com liquid + investments - liabilities', { ...validBody, total: validBody.total + 1 }],
    ['investimentos negativo', { ...validBody, investments: -1 }],
    ['passivos negativo', { ...validBody, liabilities: -1 }],
    ['valor em reais em vez de centavos', { ...validBody, liquid: 5000.5 }],
    ['campo ausente', { liquid: 100, investments: 0, liabilities: 0 }],
  ])('rejeita %s', async (_label, body) => {
    const res = await request(app).post('/api/net-worth/snapshot').set(auth(tokenA)).send(body);
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  describe('isolamento entre usuários', () => {
    it('B começa sem histórico, mesmo com A tendo registros', async () => {
      const res = await request(app).get('/api/net-worth/history').set(auth(tokenB));
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('o retrato de B não aparece no histórico de A, e vice-versa', async () => {
      const bBody = { liquid: 1, investments: 0, liabilities: 0, total: 1 };
      const post = await request(app).post('/api/net-worth/snapshot').set(auth(tokenB)).send(bBody);
      expect(post.status).toBe(200);

      const historyB = await request(app).get('/api/net-worth/history').set(auth(tokenB));
      expect(historyB.body).toHaveLength(1);
      expect(historyB.body[0]).toMatchObject(bBody);

      const historyA = await request(app).get('/api/net-worth/history').set(auth(tokenA));
      expect(historyA.body.every(h => h.total !== 1)).toBe(true);
    });
  });
});
