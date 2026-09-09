// @vitest-environment node
// FIN-048 (parte 2/2) — CRUD e isolamento por usuário das rotas /api/budgets (FIN-043).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from './test/backend-test-utils.js';

describe('/api/budgets', () => {
  let app;
  let cleanup;
  let tokenA;
  let tokenB;

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('budgets'));

    const regA = await request(app).post('/api/auth/register')
      .send({ name: 'Usuario A', email: 'usera@budgets.test', password: 'senha123' });
    expect(regA.status).toBe(200);
    tokenA = regA.body.token;

    const regB = await request(app).post('/api/auth/register')
      .send({ name: 'Usuario B', email: 'userb@budgets.test', password: 'senha123' });
    expect(regB.status).toBe(200);
    tokenB = regB.body.token;
  });

  afterAll(() => cleanup());

  it('cria um orçamento com dados válidos', async () => {
    const res = await request(app).post('/api/budgets').set('Authorization', `Bearer ${tokenA}`)
      .send({ category: 'Alimentação', monthlyLimit: 50000 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.category).toBe('Alimentação');
    expect(res.body.monthlyLimit).toBe(50000);
  });

  it('rejeita limite mensal <= 0', async () => {
    const res = await request(app).post('/api/budgets').set('Authorization', `Bearer ${tokenA}`)
      .send({ category: 'Transporte', monthlyLimit: 0 });
    expect(res.status).toBe(400);
  });

  it('rejeita categoria duplicada para o mesmo usuário (constraint única)', async () => {
    await request(app).post('/api/budgets').set('Authorization', `Bearer ${tokenA}`)
      .send({ category: 'Lazer', monthlyLimit: 10000 });
    const res = await request(app).post('/api/budgets').set('Authorization', `Bearer ${tokenA}`)
      .send({ category: 'Lazer', monthlyLimit: 20000 });
    expect(res.status).toBe(400);
  });

  it('dois usuários podem ter orçamento na mesma categoria (constraint é por usuário, não global)', async () => {
    const res = await request(app).post('/api/budgets').set('Authorization', `Bearer ${tokenB}`)
      .send({ category: 'Alimentação', monthlyLimit: 30000 });
    expect(res.status).toBe(200);
  });

  describe('isolamento entre usuários', () => {
    let budgetId;

    beforeAll(async () => {
      const res = await request(app).post('/api/budgets').set('Authorization', `Bearer ${tokenA}`)
        .send({ category: 'Saúde', monthlyLimit: 15000 });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      budgetId = res.body.id;
    });

    it('usuário B não vê o orçamento de A na listagem', async () => {
      const res = await request(app).get('/api/budgets').set('Authorization', `Bearer ${tokenB}`);
      expect(res.body.find(b => b.id === budgetId)).toBeUndefined();
    });

    it('usuário B não consegue editar o orçamento de A (no-op, não erro)', async () => {
      const res = await request(app).put(`/api/budgets/${budgetId}`).set('Authorization', `Bearer ${tokenB}`)
        .send({ monthlyLimit: 99999 });
      expect(res.status).toBe(200);
      expect(res.body.changes).toBe(0);

      const check = await request(app).get('/api/budgets').set('Authorization', `Bearer ${tokenA}`);
      expect(check.body.find(b => b.id === budgetId).monthlyLimit).toBe(15000);
    });

    it('usuário B não consegue excluir o orçamento de A', async () => {
      await request(app).delete(`/api/budgets/${budgetId}`).set('Authorization', `Bearer ${tokenB}`);
      const check = await request(app).get('/api/budgets').set('Authorization', `Bearer ${tokenA}`);
      expect(check.body.find(b => b.id === budgetId)).toBeDefined();
    });
  });

  it('exige autenticação', async () => {
    const res = await request(app).get('/api/budgets');
    expect(res.status).toBe(401);
  });
});
