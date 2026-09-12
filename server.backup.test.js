// @vitest-environment node
// FIN-079/FIN-080 — backup completo (exportação) e restauração, e as respostas em JSON para
// corpo malformado ou grande demais.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from './test/backend-test-utils.js';

const SECTIONS = ['accounts', 'transactions', 'debts', 'budgets', 'goals', 'recurring', 'investments'];

describe('Backup e restauração (FIN-079/FIN-080)', () => {
  let app;
  let cleanup;
  let prisma;
  let counter = 0;

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('backup'));
    ({ prisma } = await import('./server.js'));
  });

  afterAll(() => cleanup());

  async function newUser() {
    counter += 1;
    const email = `pessoa${counter}@backup.test`;
    const password = 'senha-forte-123';
    const res = await request(app).post('/api/auth/register').send({ name: `Pessoa ${counter}`, email, password });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    return { email, password, token: res.body.token, id: res.body.user.id };
  }

  const auth = user => ({ Authorization: `Bearer ${user.token}` });

  async function call(user, method, path, body) {
    const res = await request(app)[method](path).set(auth(user)).send(body);
    expect(res.status).toBe(200);
    return res.body;
  }

  /** Um pouco de tudo: conta em real e em dólar, cartão, lançamentos com e sem conta, dívida com itens etc. */
  async function seed(user) {
    const checking = await call(user, 'post', '/api/accounts', { name: 'Corrente', bank: 'Banco A', type: 'checking', balance: 150000, color: '#6366f1' });
    const usd = await call(user, 'post', '/api/accounts', { name: 'Conta Global', bank: 'Wise', type: 'checking', balance: 50000, currency: 'USD', color: '#14b8a6' });
    const card = await call(user, 'post', '/api/accounts', {
      name: 'Cartão', bank: 'Banco A', type: 'credit', balance: 0, limit: 500000, dueDay: 10, closingDay: 3, pendingBill: 120000, color: '#ec4899',
    });
    const batch = await call(user, 'post', '/api/transactions', { transactions: [
      { name: 'Salário', category: 'Receita', date: '2026-09-05', amount: 800000, accountId: checking.id },
      { name: 'Mercado', category: 'Alimentação', date: '2026-09-06', amount: -35049, accountId: checking.id },
      { name: 'Livro', category: 'Educação', date: '2026-09-07', amount: -2500, accountId: usd.id },
      { name: 'Jantar', category: 'Alimentação', date: '2026-09-08', amount: -12000, accountId: card.id, paymentType: 'credit' },
    ] });
    expect(batch.count).toBe(4);
    await call(user, 'post', '/api/transactions', { name: 'Dinheiro', category: 'Outros', date: '2026-09-09', amount: -1000 });
    await call(user, 'post', '/api/debts', {
      name: 'Empréstimo', category: 'Empréstimo', totalAmount: 1000000, paidAmount: 200000, monthlyPayment: 100000,
      totalInstallments: 10, paidInstallments: 2, nextDueDate: '2026-10-10', interestRate: 1.5, accountId: checking.id,
      subItems: [{ name: 'Parcela 1', amount: 100000, date: '2026-08-10' }, { name: 'Parcela 2', amount: 100000, date: '2026-09-10' }],
    });
    await call(user, 'post', '/api/budgets', { category: 'Alimentação', monthlyLimit: 150000 });
    await call(user, 'post', '/api/goals', { name: 'Viagem', targetAmount: 1000000, currentAmount: 250000, targetDate: '2027-06-30' });
    await call(user, 'post', '/api/recurring-transactions', {
      name: 'Aluguel', category: 'Moradia', amount: -250000, frequency: 'monthly', nextOccurrence: '2099-01-05', accountId: checking.id,
    });
    await call(user, 'post', '/api/investments', {
      name: 'Tesouro Selic', type: 'fixed_income', amountInvested: 1000000, currentValue: 1050000, accountId: checking.id,
    });
    return { checking, usd, card };
  }

  async function exportOf(user) {
    const res = await request(app).get('/api/account/export').set(auth(user));
    expect(res.status).toBe(200);
    return res.body;
  }

  const restore = (user, backup, password = user.password) =>
    request(app).post('/api/account/import').set(auth(user)).send({ password, backup });

  const clone = value => JSON.parse(JSON.stringify(value));

  /** Conteúdo sem os ids: o vínculo com a conta vira o nome dela, e as linhas ficam em ordem estável. */
  function withoutIds(data) {
    const accountName = new Map(data.accounts.map(a => [a.id, a.name]));
    const out = {};
    for (const section of SECTIONS) {
      out[section] = data[section]
        .map(({ id: _id, accountId, ...row }) => (section === 'accounts' ? row : { ...row, account: accountId ? accountName.get(accountId) : null }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    return out;
  }

  describe('GET /api/account/export', () => {
    it('exige autenticação', async () => {
      const res = await request(app).get('/api/account/export');
      expect(res.status).toBe(401);
    });

    it('exporta tudo o que o usuário cadastrou, em centavos, sem senha, 2FA, notificações nem userId', async () => {
      const user = await newUser();
      const { usd } = await seed(user);
      await prisma.userTwoFactor.create({ data: { userId: user.id, secret: 'v1.segredo.que.nunca-sai', enabledAt: new Date() } });
      await prisma.notification.create({ data: { userId: user.id, type: 'bill_due', title: 'Fatura', message: 'Vence logo', dedupeKey: 'k1' } });

      const res = await request(app).get('/api/account/export').set(auth(user));
      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="finflow-backup-\d{4}-\d{2}-\d{2}\.json"$/);
      expect(res.headers['cache-control']).toBe('no-store');

      const backup = res.body;
      expect(backup).toMatchObject({ format: 'finflow-backup', version: 1, user: { name: 'Pessoa ' + counter, email: user.email } });
      expect(new Date(backup.exportedAt).toISOString()).toBe(backup.exportedAt);
      expect(Object.keys(backup.data)).toEqual(SECTIONS);
      expect(SECTIONS.map(s => backup.data[s].length)).toEqual([3, 5, 1, 1, 1, 1, 1]);

      expect(backup.data.transactions.find(t => t.name === 'Mercado').amount).toBe(-35049);
      expect(backup.data.transactions.find(t => t.name === 'Livro')).toMatchObject({ currency: 'USD', accountId: usd.id });
      expect(backup.data.debts[0].subItems).toEqual([
        { name: 'Parcela 1', amount: 100000, date: '2026-08-10' },
        { name: 'Parcela 2', amount: 100000, date: '2026-09-10' },
      ]);

      const text = JSON.stringify(backup);
      for (const forbidden of [user.id, 'userId', 'passwordHash', 'segredo', 'recoveryCodes', 'dedupeKey', 'Vence logo']) {
        expect(text).not.toContain(forbidden);
      }
    });

    it('isolamento: o backup de um usuário não traz nada de outro', async () => {
      const owner = await newUser();
      await seed(owner);
      const other = await newUser();
      const backup = await exportOf(other);
      expect(SECTIONS.map(s => backup.data[s].length)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });
  });

  describe('POST /api/account/import', () => {
    it('exige autenticação', async () => {
      const res = await request(app).post('/api/account/import').send({ password: 'x', backup: {} });
      expect(res.status).toBe(401);
    });

    it('na mesma conta, devolve os dados exatamente como estavam — mesmos ids, datas e valores', async () => {
      const user = await newUser();
      await seed(user);
      const backup = await exportOf(user);

      // Bagunça depois do backup: exclui, cria e altera.
      await call(user, 'delete', `/api/transactions/${backup.data.transactions[0].id}`);
      await call(user, 'post', '/api/accounts', { name: 'Conta Nova', bank: 'Banco B', type: 'savings', balance: 1, color: '#000000' });
      await call(user, 'put', `/api/goals/${backup.data.goals[0].id}`, { currentAmount: 999 });
      await call(user, 'put', `/api/investments/${backup.data.investments[0].id}`, { currentValue: 1 });

      const res = await restore(user, backup);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        restored: { accounts: 3, transactions: 5, debts: 1, budgets: 1, goals: 1, recurring: 1, investments: 1 },
      });
      expect((await exportOf(user)).data).toEqual(backup.data);
    });

    it('senha errada: recusa e não muda nada', async () => {
      const user = await newUser();
      await seed(user);
      const before = await exportOf(user);
      const res = await restore(user, { ...before, data: { ...before.data, goals: [] } }, 'senha-errada');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Senha incorreta.');
      expect((await exportOf(user)).data).toEqual(before.data);
    });

    it('arquivo inválido é recusado com a posição do problema, sem apagar nada', async () => {
      const user = await newUser();
      const { card } = await seed(user);
      const before = await exportOf(user);

      const cases = [
        [b => { b.format = 'outro-app'; }, /não é um backup do FinFlow/],
        [b => { b.version = 2; }, /Versão de backup não suportada/],
        [b => { delete b.data.goals; }, /seção de metas/],
        [b => { delete b.data; }, /não tem a seção de dados/],
        [b => { b.data.transactions[1].date = '06/09/2026'; }, /transação nº 2 \(date\): Data deve estar no formato YYYY-MM-DD/],
        [b => { b.data.transactions[0].amount = 'muito'; }, /transação nº 1 \(amount\)/],
        [b => { b.data.accounts[0].createdAt = 'ontem'; }, /conta nº 1 \(createdAt\): Data inválida/],
        [b => { b.data.accounts[0].id = '../../etc/passwd'; }, /conta nº 1 \(id\): Identificador inválido/],
        [b => { b.data.transactions[0].accountId = 'conta-que-nao-existe'; }, /transação nº 1: aponta para uma conta que não está no arquivo/],
        [b => { b.data.accounts[1].id = b.data.accounts[0].id; }, /conta nº 2: identificador repetido/],
        [b => { b.data.investments[0].accountId = card.id; }, /investimento nº 1: vinculado a um cartão de crédito/],
        [b => { b.data.budgets.push({ ...b.data.budgets[0], id: 'outro-orcamento' }); }, /orçamento nº 2: categoria repetida/],
        [b => { b.data.transactions[1].importHash = b.data.transactions[0].importHash; }, /transação nº 2: transação importada repetida/],
      ];
      for (const [mutate, expected] of cases) {
        const backup = clone(before);
        mutate(backup);
        const res = await restore(user, backup);
        expect(res.status, String(expected)).toBe(400);
        expect(res.body.error).toMatch(expected);
      }

      for (const backup of ['texto', [before], null]) {
        const res = await restore(user, backup);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/conteúdo do arquivo de backup/);
      }
      const noPassword = await request(app).post('/api/account/import').set(auth(user)).send({ backup: before });
      expect(noPassword.status).toBe(400);

      expect((await exportOf(user)).data).toEqual(before.data);
    });

    it('o backup de outra pessoa na própria conta: ids novos, vínculos refeitos, e nada da outra pessoa muda', async () => {
      const owner = await newUser();
      await seed(owner);
      const ownerBackup = await exportOf(owner);
      const receiver = await newUser();
      await call(receiver, 'post', '/api/goals', { name: 'Meta antiga', targetAmount: 100, targetDate: '2030-01-01' });

      const res = await restore(receiver, ownerBackup);
      expect(res.status).toBe(200);

      expect((await exportOf(owner)).data).toEqual(ownerBackup.data);
      const received = (await exportOf(receiver)).data;
      const ownerIds = new Set(SECTIONS.flatMap(s => ownerBackup.data[s].map(row => row.id)));
      for (const section of SECTIONS) {
        for (const row of received[section]) expect(ownerIds.has(row.id)).toBe(false);
      }
      expect(withoutIds(received)).toEqual(withoutIds(ownerBackup.data));
      expect(received.goals.map(g => g.name)).toEqual(['Viagem']);
    });

    it('a moeda da transação vem da conta, não do arquivo', async () => {
      const user = await newUser();
      await seed(user);
      const backup = await exportOf(user);
      const tampered = clone(backup);
      tampered.data.transactions.find(t => t.name === 'Livro').currency = 'BRL';
      tampered.data.transactions.find(t => t.name === 'Mercado').currency = 'EUR';
      tampered.data.transactions.find(t => t.name === 'Dinheiro').currency = 'USD';

      expect((await restore(user, tampered)).status).toBe(200);
      const byName = new Map((await exportOf(user)).data.transactions.map(t => [t.name, t.currency]));
      expect(byName.get('Livro')).toBe('USD');
      expect(byName.get('Mercado')).toBe('BRL');
      expect(byName.get('Dinheiro')).toBe('BRL');
    });

    it('dados gravados pelo sync da Pluggy (nome vazio, moeda fora da lista) passam pelo backup', async () => {
      const user = await newUser();
      const account = await prisma.account.create({ data: {
        userId: user.id, pluggyId: 'pluggy-acc-1', name: '', bank: 'Banco Conectado', type: 'checking', balance: 1000, currency: 'JPY', color: '#6366f1',
      } });
      await prisma.transaction.create({ data: {
        userId: user.id, accountId: account.id, pluggyId: 'pluggy-tx-1', name: '', category: 'Outros', date: '2026-09-01', amount: -500, currency: 'JPY',
      } });
      const backup = await exportOf(user);
      expect(backup.data.accounts[0]).toMatchObject({ name: '', currency: 'JPY', pluggyId: 'pluggy-acc-1' });

      expect((await restore(user, backup)).status).toBe(200);
      expect((await exportOf(user)).data).toEqual(backup.data);
    });

    it('mantém a verificação em duas etapas e apaga os avisos derivados dos dados antigos', async () => {
      const user = await newUser();
      await seed(user);
      const backup = await exportOf(user);
      await prisma.userTwoFactor.create({ data: { userId: user.id, secret: 'v1.a.b.c', enabledAt: new Date() } });
      await prisma.notification.create({ data: { userId: user.id, type: 'bill_due', title: 'Fatura', message: 'x', dedupeKey: 'k' } });

      expect((await restore(user, backup)).status).toBe(200);
      expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.userTwoFactor.findUnique({ where: { userId: user.id } })).not.toBeNull();
    });

    it('aceita um backup grande, acima do limite de 100 kB das outras rotas', async () => {
      const user = await newUser();
      const transactions = Array.from({ length: 3000 }, (_, i) => ({
        id: `tx-${i}`, name: `Compra número ${i}`, category: 'Outros', date: '2026-01-01', amount: -(i + 1), paymentType: 'debit',
      }));
      const backup = { format: 'finflow-backup', version: 1, data: { accounts: [], transactions, debts: [], budgets: [], goals: [], recurring: [], investments: [] } };
      expect(JSON.stringify(backup).length).toBeGreaterThan(200 * 1024);

      const res = await restore(user, backup);
      expect(res.status).toBe(200);
      expect(res.body.restored.transactions).toBe(3000);
      expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(3000);
    });

    it('arquivo acima de 25 MB: 413 em JSON, com o limite na mensagem', async () => {
      const user = await newUser();
      const res = await request(app).post('/api/account/import').set(auth(user))
        .send({ password: user.password, backup: { format: 'finflow-backup', padding: 'x'.repeat(26 * 1024 * 1024) } });
      expect(res.status).toBe(413);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body.error).toMatch(/25 MB/);
    });
  });

  describe('erros do parser de JSON', () => {
    it('corpo malformado: 400 em JSON, sem página HTML nem pilha do erro', async () => {
      const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email": ');
      expect(res.status).toBe(400);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toEqual({ error: 'O corpo da requisição não é um JSON válido.' });
    });

    it('corpo acima do limite padrão numa rota comum: 413 em JSON', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: 'a@b.c', password: 'x'.repeat(150 * 1024) });
      expect(res.status).toBe(413);
      expect(res.body).toEqual({ error: 'Os dados enviados passam do tamanho máximo aceito.' });
    });
  });
});
