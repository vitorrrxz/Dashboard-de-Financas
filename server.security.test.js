// @vitest-environment node
// FIN-032 — testes de isolamento de dados entre usuários. Garante, via teste automatizado
// (não apenas leitura de código), que um usuário nunca acessa/altera dados de outro em
// nenhuma das 3 entidades principais (accounts, transactions, debts).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from './test/backend-test-utils.js';

describe('Isolamento de dados entre usuários', () => {
  let app;
  let cleanup;
  let tokenA;
  let tokenB;

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('isolation'));

    const regA = await request(app).post('/api/auth/register')
      .send({ name: 'Usuario A', email: 'usera@isolation.test', password: 'senha123' });
    tokenA = regA.body.token;

    const regB = await request(app).post('/api/auth/register')
      .send({ name: 'Usuario B', email: 'userb@isolation.test', password: 'senha123' });
    tokenB = regB.body.token;
  });

  afterAll(() => cleanup());

  describe('accounts', () => {
    let accountId;

    beforeAll(async () => {
      const res = await request(app).post('/api/accounts').set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Conta A', bank: 'Banco A', type: 'checking', balance: 1000, color: '#fff' });
      accountId = res.body.id;
    });

    it('usuário B não vê a conta de A na listagem', async () => {
      const res = await request(app).get('/api/accounts').set('Authorization', `Bearer ${tokenB}`);
      expect(res.body.find(a => a.id === accountId)).toBeUndefined();
    });

    it('usuário B não consegue editar a conta de A (no-op, não erro)', async () => {
      const res = await request(app).put(`/api/accounts/${accountId}`).set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Hackeado' });
      expect(res.status).toBe(200);
      expect(res.body.changes).toBe(0);

      const check = await request(app).get('/api/accounts').set('Authorization', `Bearer ${tokenA}`);
      expect(check.body.find(a => a.id === accountId).name).toBe('Conta A');
    });

    it('usuário B não consegue excluir a conta de A', async () => {
      await request(app).delete(`/api/accounts/${accountId}`).set('Authorization', `Bearer ${tokenB}`);
      const check = await request(app).get('/api/accounts').set('Authorization', `Bearer ${tokenA}`);
      expect(check.body.find(a => a.id === accountId)).toBeDefined();
    });
  });

  describe('transactions', () => {
    let txId;

    beforeAll(async () => {
      const res = await request(app).post('/api/transactions').set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Compra A', category: 'Outros', date: '2026-01-01', amount: -500 });
      txId = res.body.id;
    });

    it('usuário B não vê a transação de A na listagem', async () => {
      const res = await request(app).get('/api/transactions').set('Authorization', `Bearer ${tokenB}`);
      expect(res.body.find(t => t.id === txId)).toBeUndefined();
    });

    it('usuário B não consegue editar a transação de A (no-op, não erro)', async () => {
      const res = await request(app).put(`/api/transactions/${txId}`).set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Hackeado' });
      expect(res.status).toBe(200);
      expect(res.body.changes).toBe(0);
    });

    it('usuário B não consegue excluir a transação de A', async () => {
      await request(app).delete(`/api/transactions/${txId}`).set('Authorization', `Bearer ${tokenB}`);
      const check = await request(app).get('/api/transactions').set('Authorization', `Bearer ${tokenA}`);
      expect(check.body.find(t => t.id === txId)).toBeDefined();
    });
  });

  describe('debts', () => {
    let debtId;

    beforeAll(async () => {
      const res = await request(app).post('/api/debts').set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Divida A', category: 'Pessoal', totalAmount: 1000, monthlyPayment: 100, totalInstallments: 10, nextDueDate: '2026-02-01' });
      debtId = res.body.id;
    });

    it('usuário B não vê a dívida de A na listagem', async () => {
      const res = await request(app).get('/api/debts').set('Authorization', `Bearer ${tokenB}`);
      expect(res.body.find(d => d.id === debtId)).toBeUndefined();
    });

    it('usuário B não consegue editar a dívida de A (404, isolado por userId no where)', async () => {
      const res = await request(app).put(`/api/debts/${debtId}`).set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Hackeado' });
      expect(res.status).not.toBe(200);

      const check = await request(app).get('/api/debts').set('Authorization', `Bearer ${tokenA}`);
      expect(check.body.find(d => d.id === debtId).name).toBe('Divida A');
    });

    it('usuário B não consegue excluir a dívida de A', async () => {
      await request(app).delete(`/api/debts/${debtId}`).set('Authorization', `Bearer ${tokenB}`);
      const check = await request(app).get('/api/debts').set('Authorization', `Bearer ${tokenA}`);
      expect(check.body.find(d => d.id === debtId)).toBeDefined();
    });
  });
});
