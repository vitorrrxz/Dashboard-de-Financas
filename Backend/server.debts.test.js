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

  describe('dividir pagamento', () => {
    const splitDebt = extra => debtPayload({
      accountId, totalAmount: 300000, monthlyPayment: 100000, totalInstallments: 3, nextDueDate: '2030-01-10',
      splits: [{ day: 25, amount: 40000 }, { day: 10, amount: 60000 }], ...extra,
    });
    const pay = (debtId, splitId) => request(app).post(`/api/debts/${debtId}/splits/${splitId}/pay`).set(auth());

    it('cria com as partes em ordem de dia; partes que não somam a parcela ou uma parte só são recusadas', async () => {
      const created = await request(app).post('/api/debts').set(auth()).send(splitDebt());
      expect(created.status).toBe(200);
      expect(created.body.splits.map(({ day, amount, paid }) => ({ day, amount, paid }))).toEqual([
        { day: 10, amount: 60000, paid: false }, { day: 25, amount: 40000, paid: false },
      ]);

      const wrongSum = await request(app).post('/api/debts').set(auth()).send(splitDebt({ splits: [{ day: 10, amount: 50000 }, { day: 25, amount: 40000 }] }));
      expect(wrongSum.status).toBe(400);
      expect(wrongSum.body.error).toBe('As partes somam R$ 900,00, mas a parcela mensal é R$ 1.000,00.');
      const single = await request(app).post('/api/debts').set(auth()).send(splitDebt({ splits: [{ day: 10, amount: 100000 }] }));
      expect(single.status).toBe(400);
      expect(single.body.error).toBe('Divida o pagamento em pelo menos 2 partes.');
    });

    it('cada parte soma ao pago; a última do mês avança a parcela e libera as partes de novo', async () => {
      const { body: debt } = await request(app).post('/api/debts').set(auth()).send(splitDebt());
      const [first, second] = debt.splits;

      const p1 = await pay(debt.id, first.id);
      expect(p1.status).toBe(200);
      expect(p1.body).toMatchObject({ paidAmount: 60000, paidInstallments: 0, nextDueDate: '2030-01-10' });
      expect(p1.body.splits.map(s => s.paid)).toEqual([true, false]);

      const again = await pay(debt.id, first.id);
      expect(again.status).toBe(400);
      expect(again.body.error).toBe('Essa parte já foi paga neste mês.');

      const p2 = await pay(debt.id, second.id);
      expect(p2.status).toBe(200);
      expect(p2.body).toMatchObject({ paidAmount: 100000, paidInstallments: 1, nextDueDate: '2030-02-10' });
      expect(p2.body.splits.map(s => s.paid)).toEqual([false, false]);
    });

    it('a última parcela fecha o total, e dívida quitada não aceita mais pagamento', async () => {
      // R$ 2.500 em 3: a última parcela é R$ 500, e a parte de R$ 600 do dia 10 já a quita.
      const { body: debt } = await request(app).post('/api/debts').set(auth()).send(splitDebt({ totalAmount: 250000 }));
      for (let month = 0; month < 2; month++) {
        for (const split of debt.splits) expect((await pay(debt.id, split.id)).status).toBe(200);
      }
      const last = await pay(debt.id, debt.splits[0].id);
      expect(last.status).toBe(200);
      expect(last.body).toMatchObject({ paidAmount: 250000, paidInstallments: 3 });
      const late = await pay(debt.id, debt.splits[1].id);
      expect(late.status).toBe(400);
      expect(late.body.error).toBe('Essa dívida já está quitada.');
    });

    it('editar: refazer a divisão mantém paga a parte igual; mudar a parcela exige partes que somem; lista vazia desfaz', async () => {
      const { body: debt } = await request(app).post('/api/debts').set(auth()).send(splitDebt());
      await pay(debt.id, debt.splits[0].id); // dia 10, R$ 600

      const redo = await request(app).put(`/api/debts/${debt.id}`).set(auth())
        .send({ splits: [{ day: 10, amount: 60000 }, { day: 20, amount: 20000 }, { day: 28, amount: 20000 }] });
      expect(redo.status).toBe(200);
      expect(redo.body.splits.map(({ day, paid }) => ({ day, paid }))).toEqual([
        { day: 10, paid: true }, { day: 20, paid: false }, { day: 28, paid: false },
      ]);

      const monthlyOnly = await request(app).put(`/api/debts/${debt.id}`).set(auth()).send({ monthlyPayment: 120000 });
      expect(monthlyOnly.status).toBe(400);
      expect(monthlyOnly.body.error).toBe('As partes somam R$ 1.000,00, mas a parcela mensal é R$ 1.200,00.');

      const undo = await request(app).put(`/api/debts/${debt.id}`).set(auth()).send({ monthlyPayment: 120000, splits: [] });
      expect(undo.status).toBe(200);
      expect(undo.body.splits).toEqual([]);
      expect(undo.body.monthlyPayment).toBe(120000);
    });

    it('parte de outra dívida, ou de outro usuário, não é encontrada; excluir a dívida leva as partes', async () => {
      const { body: a } = await request(app).post('/api/debts').set(auth()).send(splitDebt());
      const { body: b } = await request(app).post('/api/debts').set(auth()).send(splitDebt());
      const crossed = await pay(a.id, b.splits[0].id);
      expect(crossed.status).toBe(404);

      const other = await request(app).post('/api/auth/sign-up/email').send({ name: 'Outro', email: 'outro@debts.test', password: 'senha123' });
      const foreign = await request(app).post(`/api/debts/${a.id}/splits/${a.splits[0].id}/pay`).set({ Authorization: `Bearer ${other.body.token}` });
      expect(foreign.status).toBe(404);

      const removed = await request(app).delete(`/api/debts/${a.id}`).set(auth());
      expect(removed.status).toBe(200);
      const { prisma } = await import('./server.js');
      expect(await prisma.debtSplit.count({ where: { debtId: a.id } })).toBe(0);
    });
  });
});
