// @vitest-environment node
// Excluir uma conta exclui as transações dela — sem isso elas ficavam sem conta (SET NULL) e
// continuavam somando no Dashboard.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from './test/backend-test-utils.js';

describe('DELETE /api/accounts/:id', () => {
  let app;
  let cleanup;
  let tokenA;
  let tokenB;
  const auth = token => ({ Authorization: `Bearer ${token}` });

  async function register(email) {
    const res = await request(app).post('/api/auth/register').send({ name: email, email, password: 'senha123' });
    expect(res.status).toBe(200);
    return res.body.token;
  }
  async function createAccount(token, name) {
    const res = await request(app).post('/api/accounts').set(auth(token))
      .send({ name, bank: 'Banco', type: 'checking', balance: 0, color: '#fff' });
    expect(res.status).toBe(200);
    return res.body.id;
  }
  async function addTx(token, accountId, name) {
    const res = await request(app).post('/api/transactions').set(auth(token))
      .send({ transactions: [{ name, category: 'Outros', date: '2026-10-01', amount: -1000, accountId }] });
    expect(res.status).toBe(200);
  }
  const txNames = async token => (await request(app).get('/api/transactions').set(auth(token))).body.map(t => t.name);

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('accounts_delete'));
    tokenA = await register('a@accounts-delete.test');
    tokenB = await register('b@accounts-delete.test');
  });

  afterAll(() => cleanup());

  it('leva junto só as transações da conta excluída', async () => {
    const gone = await createAccount(tokenA, 'Some');
    const kept = await createAccount(tokenA, 'Fica');
    await addTx(tokenA, gone, 'da conta excluída');
    await addTx(tokenA, kept, 'da outra conta');

    expect((await request(app).delete(`/api/accounts/${gone}`).set(auth(tokenA))).status).toBe(200);
    expect(await txNames(tokenA)).toEqual(['da outra conta']);
  });

  it('não mexe na conta nem nas transações de outro usuário', async () => {
    const ofB = await createAccount(tokenB, 'De B');
    await addTx(tokenB, ofB, 'de B');
    expect((await request(app).delete(`/api/accounts/${ofB}`).set(auth(tokenA))).status).toBe(200);
    expect(await txNames(tokenB)).toEqual(['de B']);
  });
});
