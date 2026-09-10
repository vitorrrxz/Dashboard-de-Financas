// @vitest-environment node
// FIN-052 (parte 2/2) — CRUD e isolamento por usuário das rotas /api/goals (FIN-050).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from './test/backend-test-utils.js';

describe('/api/goals', () => {
  let app;
  let cleanup;
  let tokenA;
  let tokenB;

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
