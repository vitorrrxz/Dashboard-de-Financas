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
      // Sem esta asserção, uma falha silenciosa na criação (ex.: schema mudou, 500) deixaria
      // `accountId` undefined e os testes abaixo passariam trivialmente (comparando com
      // `undefined` em vez de testar isolamento de verdade) — ver nitpick do CodeRabbit.
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
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
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
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
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      debtId = res.body.id;
    });

    it('usuário B não vê a dívida de A na listagem', async () => {
      const res = await request(app).get('/api/debts').set('Authorization', `Bearer ${tokenB}`);
      expect(res.body.find(d => d.id === debtId)).toBeUndefined();
    });

    it('usuário B não consegue editar a dívida de A (404, isolado por userId no where)', async () => {
      const res = await request(app).put(`/api/debts/${debtId}`).set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Hackeado' });
      expect(res.status).toBe(404);

      const check = await request(app).get('/api/debts').set('Authorization', `Bearer ${tokenA}`);
      expect(check.body.find(d => d.id === debtId).name).toBe('Divida A');
    });

    it('usuário B não consegue excluir a dívida de A', async () => {
      await request(app).delete(`/api/debts/${debtId}`).set('Authorization', `Bearer ${tokenB}`);
      const check = await request(app).get('/api/debts').set('Authorization', `Bearer ${tokenA}`);
      expect(check.body.find(d => d.id === debtId)).toBeDefined();
    });
  });

  // FIN-096 — a chave estrangeira só garante que a conta existe: sem conferir a posse, B conseguia
  // vincular as próprias transações, dívidas e recorrências à conta de A.
  describe('vínculo com a conta de outro usuário (FIN-096)', () => {
    const NOT_FOUND = 'Conta vinculada não encontrada.';
    const auth = token => ({ Authorization: `Bearer ${token}` });
    const txPayload = (name, accountId) => ({ name, category: 'Outros', date: '2026-03-01', amount: -700, accountId });
    const debtPayload = (name, accountId) => ({
      name, category: 'Pessoal', totalAmount: 1200, monthlyPayment: 100, totalInstallments: 12, nextDueDate: '2030-01-10', accountId,
    });
    // Próxima ocorrência no futuro: nenhuma rota de processamento lança nada durante o teste.
    const recurringPayload = (name, accountId) => ({
      name, category: 'Moradia', amount: -150000, frequency: 'monthly', nextOccurrence: '2030-01-05', accountId,
    });
    let accountA;
    let accountB;

    /** Lista (array) de uma rota GET, conferindo o status antes de usar o corpo. */
    async function listOf(path, token) {
      const res = await request(app).get(path).set(auth(token));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      return res.body;
    }

    beforeAll(async () => {
      const create = async (token, name) => {
        const res = await request(app).post('/api/accounts').set(auth(token))
          .send({ name, bank: 'Banco', type: 'checking', balance: 0, color: '#fff' });
        expect(res.status).toBe(200);
        expect(res.body.id).toBeDefined();
        return res.body.id;
      };
      // A conta de A existe de verdade: a recusa abaixo não pode vir da chave estrangeira.
      accountA = await create(tokenA, 'Conta de A (vínculo)');
      accountB = await create(tokenB, 'Conta de B (vínculo)');
    });

    it('transação avulsa: a conta de A é recusada com 400 e nada é gravado; a própria conta passa', async () => {
      const foreign = await request(app).post('/api/transactions').set(auth(tokenB)).send(txPayload('Vinculo alheio', accountA));
      expect(foreign.status).toBe(400);
      expect(foreign.body.error).toBe(NOT_FOUND);

      // O mesmo payload com a conta de B é aceito: a recusa acima vem só da posse da conta.
      const own = await request(app).post('/api/transactions').set(auth(tokenB)).send(txPayload('Vinculo proprio', accountB));
      expect(own.status).toBe(200);
      expect(own.body.accountId).toBe(accountB);

      const names = (await listOf('/api/transactions', tokenB)).map(t => t.name);
      expect(names).not.toContain('Vinculo alheio');
      expect(names).toContain('Vinculo proprio');
    });

    it('importação em lote: uma linha com a conta de A recusa o lote inteiro, sem gravar nenhuma', async () => {
      const mixed = await request(app).post('/api/transactions').set(auth(tokenB))
        .send({ transactions: [txPayload('Lote linha propria', accountB), txPayload('Lote linha alheia', accountA)] });
      expect(mixed.status).toBe(400);
      expect(mixed.body.error).toBe(NOT_FOUND);
      let names = (await listOf('/api/transactions', tokenB)).map(t => t.name);
      expect(names).not.toContain('Lote linha propria');
      expect(names).not.toContain('Lote linha alheia');

      // Sem a linha alheia, o mesmo lote entra.
      const ownOnly = await request(app).post('/api/transactions').set(auth(tokenB))
        .send({ transactions: [txPayload('Lote linha propria', accountB)] });
      expect(ownOnly.status).toBe(200);
      expect(ownOnly.body.count).toBe(1);
      names = (await listOf('/api/transactions', tokenB)).map(t => t.name);
      expect(names).toContain('Lote linha propria');
    });

    it('editar transação: não troca para a conta de A; desvincular continua possível', async () => {
      const created = await request(app).post('/api/transactions').set(auth(tokenB)).send(txPayload('Editar vinculo', accountB));
      expect(created.status).toBe(200);
      const id = created.body.id;
      expect(id).toBeDefined();

      const foreign = await request(app).put(`/api/transactions/${id}`).set(auth(tokenB)).send({ accountId: accountA });
      expect(foreign.status).toBe(400);
      expect(foreign.body.error).toBe(NOT_FOUND);
      expect((await listOf('/api/transactions', tokenB)).find(t => t.id === id).accountId).toBe(accountB);

      // `''` é "sem conta vinculada" (vira `null`) e não passa pela checagem de posse.
      const unlink = await request(app).put(`/api/transactions/${id}`).set(auth(tokenB)).send({ accountId: '' });
      expect(unlink.status).toBe(200);
      expect(unlink.body.changes).toBe(1);
      expect((await listOf('/api/transactions', tokenB)).find(t => t.id === id).accountId).toBeNull();
    });

    it.each([
      ['dívida', '/api/debts', debtPayload],
      ['recorrência', '/api/recurring-transactions', recurringPayload],
    ])('%s: criar e editar recusam a conta de A', async (_label, path, payload) => {
      const foreign = await request(app).post(path).set(auth(tokenB)).send(payload('Criar alheio', accountA));
      expect(foreign.status).toBe(400);
      expect(foreign.body.error).toBe(NOT_FOUND);

      const created = await request(app).post(path).set(auth(tokenB)).send(payload('Criar proprio', accountB));
      expect(created.status).toBe(200);
      const id = created.body.id;
      expect(id).toBeDefined();
      expect(created.body.accountId).toBe(accountB);

      const edit = await request(app).put(`${path}/${id}`).set(auth(tokenB)).send({ accountId: accountA });
      expect(edit.status).toBe(400);
      expect(edit.body.error).toBe(NOT_FOUND);

      const list = await listOf(path, tokenB);
      expect(list.map(r => r.name)).not.toContain('Criar alheio');
      expect(list.find(r => r.id === id).accountId).toBe(accountB);
    });

    it('id de conta inexistente também é recusado com 400, nas três rotas', async () => {
      for (const [path, body] of [
        ['/api/transactions', txPayload('Conta fantasma', 'conta-que-nao-existe')],
        ['/api/debts', debtPayload('Conta fantasma', 'conta-que-nao-existe')],
        ['/api/recurring-transactions', recurringPayload('Conta fantasma', 'conta-que-nao-existe')],
      ]) {
        const res = await request(app).post(path).set(auth(tokenB)).send(body);
        expect(res.status, path).toBe(400);
        expect(res.body.error, path).toBe(NOT_FOUND);
      }
    });

    it('A continua sem nenhum registro de B vinculado à própria conta', async () => {
      const txs = await listOf('/api/transactions', tokenA);
      const debts = await listOf('/api/debts', tokenA);
      const recurring = await listOf('/api/recurring-transactions', tokenA);
      for (const record of [...txs, ...debts, ...recurring]) expect(record.accountId).not.toBe(accountB);
      // E nada de B aponta para a conta de A.
      const ofB = [
        ...await listOf('/api/transactions', tokenB),
        ...await listOf('/api/debts', tokenB),
        ...await listOf('/api/recurring-transactions', tokenB),
      ];
      expect(ofB.length).toBeGreaterThan(0);
      expect(ofB.filter(record => record.accountId === accountA)).toEqual([]);
    });
  });
});
