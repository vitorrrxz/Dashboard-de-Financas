// @vitest-environment node
// FIN-107 — conexões da Pluggy registradas e sincronização automática ao abrir o app: a conexão
// recente não sincroniza, a parada sincroniza uma vez só mesmo com duas abas, a de login expirado
// fica de fora e o erro da Pluggy não derruba a resposta. A Pluggy é um cliente de mentira.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createTestApp } from './test/backend-test-utils.js';

const pluggy = vi.hoisted(() => ({
  fetchItem: vi.fn(),
  fetchAccount: vi.fn(),
  fetchAccounts: vi.fn(),
  fetchTransactions: vi.fn(),
}));
// Construtor que devolve o objeto acima: o `new PluggyClient(...)` de server.js recebe o cliente de mentira.
vi.mock('pluggy-sdk', () => ({ PluggyClient: class { constructor() { return pluggy; } } }));

const ITEM = { id: 'item-1', status: 'UPDATED', connector: { name: 'Itaú' }, clientUserId: null };
const ACCOUNT = {
  id: 'acc-1', itemId: 'item-1', type: 'BANK', subtype: 'CHECKING_ACCOUNT', name: 'Conta Itaú',
  marketingName: 'Itaú', balance: 150.5, currencyCode: 'BRL',
};
const TX = { id: 'ptx-1', description: 'Mercado', amount: -42.1, date: new Date('2026-09-10T12:00:00Z'), category: 'Groceries' };
const HOUR = 60 * 60 * 1000;

describe('sincronização automática com a Pluggy (FIN-107)', () => {
  let app;
  let cleanup;
  let prisma;
  let tokenA;
  let tokenB;
  let userA;
  const auth = token => ({ Authorization: `Bearer ${token}` });
  const autoSync = token => request(app).post('/api/pluggy/auto-sync').set(auth(token));

  async function register(email) {
    const res = await request(app).post('/api/auth/register').send({ name: email, email, password: 'senha123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    return res.body.token;
  }

  // Conexão do usuário A já registrada, com a hora da última sincronização.
  const addItem = (lastSyncAt, extra = {}) => prisma.pluggyItem.create({
    data: { userId: userA, pluggyId: 'item-1', providerName: 'Itaú', status: 'UPDATED', lastSyncAt, ...extra },
  });

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('pluggy_sync'));
    ({ prisma } = await import('./server.js'));
    // O cliente só é criado na primeira chamada, e exige as duas variáveis.
    process.env.PLUGGY_CLIENT_ID = 'test-client';
    process.env.PLUGGY_CLIENT_SECRET = 'test-secret';
    tokenA = await register('a@pluggy.test');
    tokenB = await register('b@pluggy.test');
    const me = await request(app).get('/api/auth/me').set(auth(tokenA));
    expect(me.status).toBe(200);
    userA = me.body.user.userId;
    expect(userA).toEqual(expect.any(String));
  });

  afterAll(() => cleanup());

  beforeEach(async () => {
    vi.resetAllMocks();
    pluggy.fetchItem.mockResolvedValue(ITEM);
    pluggy.fetchAccount.mockResolvedValue(ACCOUNT);
    pluggy.fetchAccounts.mockResolvedValue({ results: [ACCOUNT] });
    pluggy.fetchTransactions.mockResolvedValue({ results: [TX], totalPages: 1 });
    await prisma.transaction.deleteMany();
    await prisma.account.deleteMany();
    await prisma.pluggyItem.deleteMany();
  });

  it('conectar registra a conexão sem criar conta de saldo zero, e a automática já a sincroniza', async () => {
    const connected = await request(app).post('/api/pluggy/connect-item').set(auth(tokenA)).send({ itemId: 'item-1' });
    expect(connected.status).toBe(200);
    expect(connected.body).toMatchObject({ providerName: 'Itaú', statusMessage: null });
    expect((await request(app).get('/api/accounts').set(auth(tokenA))).body).toEqual([]);

    const res = await autoSync(tokenA);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ synced: 1, items: [{ pluggyId: 'item-1', providerName: 'Itaú', status: 'UPDATED' }] });
    expect(Date.now() - Date.parse(res.body.items[0].lastSyncAt)).toBeLessThan(60_000);
    expect((await request(app).get('/api/accounts').set(auth(tokenA))).body).toEqual([expect.objectContaining({ name: 'Conta Itaú' })]);
  });

  it('conexão sincronizada há menos de 6 h não sincroniza; passadas as 6 h, sincroniza', async () => {
    const item = await addItem(new Date(Date.now() - HOUR));
    const recent = await autoSync(tokenA);
    expect(recent.status).toBe(200);
    expect(recent.body.synced).toBe(0);
    expect(pluggy.fetchItem).not.toHaveBeenCalled();

    await prisma.pluggyItem.update({ where: { id: item.id }, data: { lastSyncAt: new Date(Date.now() - 7 * HOUR) } });
    const stale = await autoSync(tokenA);
    expect(stale.body.synced).toBe(1);
    expect(pluggy.fetchAccounts).toHaveBeenCalledOnce();
  });

  it('duas abas ao mesmo tempo: a conexão parada sincroniza uma vez só', async () => {
    await addItem(null);
    // A Pluggy demora um pouco, para as duas requisições se sobreporem de fato.
    pluggy.fetchItem.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(ITEM), 30)));

    const [first, second] = await Promise.all([autoSync(tokenA), autoSync(tokenA)]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body.synced + second.body.synced).toBe(1);
    expect(pluggy.fetchItem).toHaveBeenCalledOnce();
    expect(pluggy.fetchAccounts).toHaveBeenCalledOnce();
    expect(await prisma.transaction.count()).toBe(1);
  });

  it('conexão com login expirado fica fora da automática, mesmo parada', async () => {
    await addItem(null, { status: 'LOGIN_ERROR' });
    const res = await autoSync(tokenA);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ synced: 0, items: [{ status: 'LOGIN_ERROR', lastSyncAt: null }] });
    expect(pluggy.fetchItem).not.toHaveBeenCalled();
  });

  it('erro da Pluggy não derruba a resposta: a conexão continua listada, sem hora nova', async () => {
    await addItem(null);
    pluggy.fetchItem.mockRejectedValue(new Error('Pluggy fora do ar'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await autoSync(tokenA);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ synced: 0, items: [{ pluggyId: 'item-1', lastSyncAt: null }] });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('pelo botão: só a conexão do próprio usuário; o login expirado responde 409 e fica gravado', async () => {
    await addItem(null);
    const ofOther = await request(app).post('/api/pluggy/sync/item-1').set(auth(tokenB));
    expect(ofOther.status).toBe(404);
    expect(pluggy.fetchItem).not.toHaveBeenCalled();

    const own = await request(app).post('/api/pluggy/sync/item-1').set(auth(tokenA));
    expect(own.status).toBe(200);
    expect((await prisma.pluggyItem.findFirst()).lastSyncAt).toBeInstanceOf(Date);

    pluggy.fetchItem.mockResolvedValue({ ...ITEM, status: 'LOGIN_ERROR' });
    const expired = await request(app).post('/api/pluggy/sync/item-1').set(auth(tokenA));
    expect(expired.status).toBe(409);
    expect((await prisma.pluggyItem.findFirst()).status).toBe('LOGIN_ERROR');
  });

  it('conexão feita antes da tabela: é achada pela conta já sincronizada e passa a sincronizar', async () => {
    await prisma.account.create({
      data: { userId: userA, pluggyId: 'acc-1', name: 'Conta Itaú', bank: 'Itaú', type: 'checking', balance: 0, color: '#6366f1' },
    });
    const res = await autoSync(tokenA);
    expect(res.status).toBe(200);
    expect(pluggy.fetchAccount).toHaveBeenCalledWith('acc-1');
    expect(res.body).toMatchObject({ synced: 1, items: [{ pluggyId: 'item-1', providerName: 'Itaú' }] });
    // A conta já existente é a mesma, atualizada — não uma segunda.
    expect(await prisma.account.count()).toBe(1);
  });

  it('conexão de outro usuário da Pluggy (clientUserId diferente) não é registrada', async () => {
    pluggy.fetchItem.mockResolvedValue({ ...ITEM, clientUserId: 'outro-usuario' });
    const res = await request(app).post('/api/pluggy/connect-item').set(auth(tokenA)).send({ itemId: 'item-1' });
    expect(res.status).toBe(404);
    expect(await prisma.pluggyItem.count()).toBe(0);
  });
});
