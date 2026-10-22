// @vitest-environment node
// FIN-125 — toda dívida nova nasce ligada a uma conta; editar pode trocar a conta, mas não desvincular.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from './test/backend-test-utils.js';

const REQUIRED = 'Selecione a conta vinculada à dívida.';

describe('/api/debts — conta vinculada obrigatória', () => {
  let app;
  let cleanup;
  let token;
  let accountId;
  let otherAccountId;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const debtPayload = extra => ({
    name: 'Empréstimo', category: 'Empréstimo', totalAmount: 120000, monthlyPayment: 10000, totalInstallments: 12, nextDueDate: '2030-01-10', ...extra,
  });

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('debts'));
    const reg = await request(app).post('/api/auth/sign-up/email')
      .send({ name: 'Usuario', email: 'user@debts.test', password: 'senha123' });
    expect(reg.status).toBe(200);
    token = reg.body.token;
    const create = async name => {
      const res = await request(app).post('/api/accounts').set(auth())
        .send({ name, bank: 'Banco', type: 'checking', balance: 0, color: '#fff' });
      expect(res.status).toBe(200);
      return res.body.id;
    };
    accountId = await create('Corrente');
    otherAccountId = await create('Poupança');
  });

  afterAll(() => cleanup());

  it.each([
    ['sem accountId', {}],
    ['accountId vazio', { accountId: '' }],
    ['accountId nulo', { accountId: null }],
  ])('criar %s é recusado com 400 e nada é gravado', async (_label, extra) => {
    const res = await request(app).post('/api/debts').set(auth()).send(debtPayload({ name: 'Sem conta', ...extra }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(REQUIRED);
    const list = await request(app).get('/api/debts').set(auth());
    expect(list.body.map(d => d.name)).not.toContain('Sem conta');
  });

  it('criar com conta do usuário passa; editar troca a conta, mas não desvincula', async () => {
    const created = await request(app).post('/api/debts').set(auth()).send(debtPayload({ accountId }));
    expect(created.status).toBe(200);
    expect(created.body.accountId).toBe(accountId);
    const id = created.body.id;

    // Pagar parcela manda só os campos do pagamento, sem `accountId`: a conta fica como está.
    const pay = await request(app).put(`/api/debts/${id}`).set(auth()).send({ paidAmount: 10000, paidInstallments: 1 });
    expect(pay.status).toBe(200);
    expect(pay.body.accountId).toBe(accountId);

    const swap = await request(app).put(`/api/debts/${id}`).set(auth()).send({ accountId: otherAccountId });
    expect(swap.status).toBe(200);
    expect(swap.body.accountId).toBe(otherAccountId);

    for (const accountIdValue of ['', null]) {
      const unlink = await request(app).put(`/api/debts/${id}`).set(auth()).send({ accountId: accountIdValue });
      expect(unlink.status).toBe(400);
      expect(unlink.body.error).toBe(REQUIRED);
    }
    const list = await request(app).get('/api/debts').set(auth());
    expect(list.body.find(d => d.id === id).accountId).toBe(otherAccountId);
  });
});
