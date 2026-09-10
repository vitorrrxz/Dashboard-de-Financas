// @vitest-environment node
// FIN-065 a FIN-069 — central de notificações: rotas e isolamento entre usuários, geração
// idempotente dos avisos de vencimento, reconciliação quando a parcela é paga e os alertas
// de gasto incomum por categoria.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from './test/backend-test-utils.js';

/** Hoje deslocado em `days` dias (negativo = passado), em ISO local — mesma convenção do server. */
function isoFromToday(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('notificações (FIN-065 a FIN-069)', () => {
  let app;
  let cleanup;
  let server;
  let userSeq = 0;

  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  /** Cria um usuário novo por teste — nenhum teste depende do estado deixado por outro. */
  async function newUser() {
    userSeq += 1;
    const res = await request(app).post('/api/auth/register')
      .send({ name: `Usuario ${userSeq}`, email: `user${userSeq}@notifications.test`, password: 'senha123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user?.id).toBeDefined();
    return { token: res.body.token, userId: res.body.user.id };
  }

  /** Dívida de 4 parcelas de R$ 250,00 (valores em centavos, como no banco). */
  async function createDebt(userId, overrides = {}) {
    const debt = await server.prisma.debt.create({
      data: {
        userId, name: 'Empréstimo', category: 'Empréstimo',
        totalAmount: 100000, paidAmount: 0, monthlyPayment: 25000,
        totalInstallments: 4, paidInstallments: 0, nextDueDate: isoFromToday(3),
        ...overrides,
      },
    });
    expect(debt.id).toBeDefined();
    return debt;
  }

  async function generate(token) {
    const res = await request(app).post('/api/notifications/generate').set(auth(token));
    expect(res.status).toBe(200);
    return res.body;
  }

  async function list(token) {
    const res = await request(app).get('/api/notifications').set(auth(token));
    expect(res.status).toBe(200);
    return res.body;
  }

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('notifications'));
    server = await import('./server.js');
  });

  afterAll(() => cleanup());

  describe('nextBillDueDate', () => {
    it('usa o vencimento deste mês quando ainda não passou', () => {
      expect(server.nextBillDueDate(15, '2026-09-10')).toBe('2026-09-15');
    });
    it('o próprio dia de hoje ainda conta como a vencer', () => {
      expect(server.nextBillDueDate(10, '2026-09-10')).toBe('2026-09-10');
    });
    it('vira para o mês seguinte quando o dia já passou', () => {
      expect(server.nextBillDueDate(5, '2026-09-10')).toBe('2026-10-05');
    });
    it('vira o ano em dezembro', () => {
      expect(server.nextBillDueDate(5, '2026-12-20')).toBe('2027-01-05');
    });
    it('ajusta o dia 31 ao tamanho do mês', () => {
      expect(server.nextBillDueDate(31, '2026-09-10')).toBe('2026-09-30');
      expect(server.nextBillDueDate(31, '2026-02-01')).toBe('2026-02-28');
    });
  });

  describe('pluggyBillDueDay', () => {
    it('lê o dia em UTC, sem o deslocamento do fuso do Brasil', () => {
      expect(server.pluggyBillDueDay({ dueDate: new Date('2026-09-15T00:00:00Z') })).toBe(15);
      expect(server.pluggyBillDueDay({ dueDate: '2026-09-15T00:00:00.000Z' })).toBe(15);
    });
    it('devolve undefined sem data ou com data inválida', () => {
      expect(server.pluggyBillDueDay({})).toBeUndefined();
      expect(server.pluggyBillDueDay({ dueDate: 'lixo' })).toBeUndefined();
      expect(server.pluggyBillDueDay(undefined)).toBeUndefined();
    });
  });

  describe('buildDueNotifications (FIN-067)', () => {
    const TODAY = '2026-09-10';
    const debt = (overrides = {}) => ({
      id: 'd1', name: 'Empréstimo',
      totalAmount: 100000, paidAmount: 0, monthlyPayment: 25000,
      totalInstallments: 4, paidInstallments: 0, nextDueDate: '2026-09-15',
      ...overrides,
    });
    const card = (overrides = {}) => ({ id: 'c1', name: 'Nubank', type: 'credit', dueDay: 15, pendingBill: 77160, ...overrides });

    it('avisa a parcela que vence dentro da janela, com valor e data absolutos', () => {
      const [n] = server.buildDueNotifications([debt()], [], TODAY, 7);
      expect(n.type).toBe('debt_due');
      expect(n.dedupeKey).toBe('debt_due:d1:2026-09-15');
      expect(n.message).toBe('A parcela 1/4 (R$ 250,00) vence em 15/09.');
    });

    it('o último dia da janela ainda conta, o seguinte não', () => {
      expect(server.buildDueNotifications([debt({ nextDueDate: '2026-09-17' })], [], TODAY, 7)).toHaveLength(1);
      expect(server.buildDueNotifications([debt({ nextDueDate: '2026-09-18' })], [], TODAY, 7)).toEqual([]);
    });

    it('parcela já vencida vira debt_overdue, com chave própria', () => {
      const [n] = server.buildDueNotifications([debt({ nextDueDate: '2026-09-05' })], [], TODAY, 7);
      expect(n.type).toBe('debt_overdue');
      expect(n.dedupeKey).toBe('debt_overdue:d1:2026-09-05');
    });

    it('dívida quitada pelas parcelas não gera aviso', () => {
      expect(server.buildDueNotifications([debt({ paidInstallments: 4, paidAmount: 100000 })], [], TODAY, 7)).toEqual([]);
    });

    it('dívida quitada pelo valor não gera aviso, mesmo com parcela nominal restante', () => {
      // Só a condição de valor é verdadeira aqui: 3 de 4 parcelas, mas o total já foi pago.
      expect(server.buildDueNotifications([debt({ paidInstallments: 3, paidAmount: 100000 })], [], TODAY, 7)).toEqual([]);
    });

    it('a última parcela mostra o saldo restante, não a parcela cheia', () => {
      const [n] = server.buildDueNotifications([debt({ totalAmount: 90000, paidInstallments: 3, paidAmount: 75000 })], [], TODAY, 7);
      expect(n.message).toContain('parcela 4/4 (R$ 150,00)');
    });

    it('avisa a fatura do cartão com dia de vencimento e valor pendente', () => {
      const [n] = server.buildDueNotifications([], [card()], TODAY, 7);
      expect(n.type).toBe('bill_due');
      expect(n.dedupeKey).toBe('bill_due:c1:2026-09-15');
      expect(n.message).toBe('A fatura de R$ 771,60 vence em 15/09.');
    });

    it('cartão sem fatura pendente, sem dia de vencimento ou com dia inválido não gera aviso', () => {
      expect(server.buildDueNotifications([], [
        card({ pendingBill: 0 }), card({ pendingBill: null }),
        card({ dueDay: null }), card({ dueDay: 0 }), card({ dueDay: 40 }),
      ], TODAY, 7)).toEqual([]);
    });

    it('conta que não é cartão é ignorada mesmo com dia de vencimento', () => {
      expect(server.buildDueNotifications([], [card({ type: 'checking' })], TODAY, 7)).toEqual([]);
    });

    it('fatura fora da janela não gera aviso', () => {
      expect(server.buildDueNotifications([], [card({ dueDay: 25 })], TODAY, 7)).toEqual([]);
    });
  });

  describe('detectUnusualSpending (FIN-069)', () => {
    const TODAY = '2026-09-20';
    const OPTIONS = { months: 3, threshold: 0.5, minCents: 5000 };
    // Despesa em centavos (negativa, como no banco).
    const spend = (date, category, cents) => ({ date, category, amount: -cents });
    // Três meses de base (jun–ago) com R$ 300,00 em Alimentação; o 1º lançamento em 01/06
    // deixa junho inteiro dentro do histórico.
    const baseline = [
      spend('2026-06-01', 'Alimentação', 30000),
      spend('2026-07-10', 'Alimentação', 30000),
      spend('2026-08-10', 'Alimentação', 30000),
    ];

    it('alerta quando o gasto do mês passa da média pelo limiar', () => {
      const [n] = server.detectUnusualSpending([...baseline, spend('2026-09-05', 'Alimentação', 50000)], TODAY, OPTIONS);
      expect(n.type).toBe('unusual_spending');
      expect(n.message).toBe('Setembro: R$ 500,00 em Alimentação, 67% acima da média de R$ 300,00 dos 3 meses anteriores.');
    });

    it('um alerta por categoria por mês: a chave inclui o mês', () => {
      const [n] = server.detectUnusualSpending([...baseline, spend('2026-09-05', 'Alimentação', 50000)], TODAY, OPTIONS);
      expect(n.dedupeKey).toBe('unusual_spending:2026-09:Alimentação');
    });

    it('abaixo do limiar não alerta', () => {
      expect(server.detectUnusualSpending([...baseline, spend('2026-09-05', 'Alimentação', 40000)], TODAY, OPTIONS)).toEqual([]);
    });

    it('exatamente no limiar alerta', () => {
      expect(server.detectUnusualSpending([...baseline, spend('2026-09-05', 'Alimentação', 45000)], TODAY, OPTIONS)).toHaveLength(1);
    });

    it('diferença absoluta pequena não alerta, mesmo com percentual alto', () => {
      const small = [spend('2026-06-01', 'Café', 2000), spend('2026-07-10', 'Café', 2000), spend('2026-08-10', 'Café', 2000)];
      // +100%, mas só R$ 20,00 acima da média — abaixo do mínimo de R$ 50,00.
      expect(server.detectUnusualSpending([...small, spend('2026-09-05', 'Café', 4000)], TODAY, OPTIONS)).toEqual([]);
    });

    it('mês anterior ao início do histórico não entra na média', () => {
      // Histórico começa em 08/08: agosto está incompleto e junho/julho não têm dado — sem base.
      const txs = [spend('2026-08-08', 'Alimentação', 30000), spend('2026-09-05', 'Alimentação', 90000)];
      expect(server.detectUnusualSpending(txs, TODAY, OPTIONS)).toEqual([]);
    });

    it('usa o início de histórico informado, e não o da janela recebida', () => {
      // Sem `historyStart`, junho (primeiro lançamento em 10/06) seria considerado incompleto.
      const txs = [
        spend('2026-06-10', 'Alimentação', 30000), spend('2026-07-10', 'Alimentação', 30000),
        spend('2026-08-10', 'Alimentação', 30000), spend('2026-09-05', 'Alimentação', 47000),
      ];
      expect(server.detectUnusualSpending(txs, TODAY, OPTIONS)).toHaveLength(1); // base jul–ago
      expect(server.detectUnusualSpending(txs, TODAY, { ...OPTIONS, historyStart: '2026-01-15' })).toHaveLength(1); // base jun–ago
    });

    it('exige ao menos 2 meses de base', () => {
      const txs = [spend('2026-08-01', 'Alimentação', 30000), spend('2026-09-05', 'Alimentação', 90000)];
      expect(server.detectUnusualSpending(txs, TODAY, OPTIONS)).toEqual([]);
    });

    it('mês sem nenhuma transação dentro do histórico não conta como gasto zero', () => {
      // Julho vazio: com ele, a média cairia para R$ 200,00 e R$ 420,00 seria +110%; sem ele,
      // a média é R$ 300,00 e o aumento, +40% — abaixo do limiar.
      const txs = [spend('2026-06-01', 'Alimentação', 30000), spend('2026-08-10', 'Alimentação', 30000), spend('2026-09-05', 'Alimentação', 42000)];
      expect(server.detectUnusualSpending(txs, TODAY, OPTIONS)).toEqual([]);
    });

    it('categoria sem gasto num mês que tem dados conta como zero', () => {
      // Lazer: 100 + 0 + 100 → média de R$ 66,67; R$ 140,00 é +110%. Se o mês zerado fosse
      // ignorado, a média seria R$ 100,00 e o aumento, +40% — sem alerta.
      const txs = [
        ...baseline,
        spend('2026-06-02', 'Lazer', 10000), spend('2026-08-11', 'Lazer', 10000),
        spend('2026-09-05', 'Lazer', 14000),
      ];
      const alerts = server.detectUnusualSpending(txs, TODAY, OPTIONS);
      expect(alerts.map(a => a.dedupeKey)).toEqual(['unusual_spending:2026-09:Lazer']);
    });

    it('categoria nova no mês gera alerta com mensagem própria', () => {
      const [n] = server.detectUnusualSpending([...baseline, spend('2026-09-05', 'Viagem', 80000)], TODAY, OPTIONS);
      expect(n.message).toBe('Setembro: R$ 800,00 em Viagem, sem gasto nessa categoria nos 3 meses anteriores.');
    });

    it('lançamento com data depois de hoje ainda não conta como gasto do mês', () => {
      expect(server.detectUnusualSpending([...baseline, spend('2026-09-25', 'Alimentação', 90000)], TODAY, OPTIONS)).toEqual([]);
    });

    it('receitas e estornos não contam como gasto', () => {
      const txs = [...baseline, { date: '2026-09-05', category: 'Alimentação', amount: 90000 }];
      expect(server.detectUnusualSpending(txs, TODAY, OPTIONS)).toEqual([]);
    });

    it('sem transações não gera nada', () => {
      expect(server.detectUnusualSpending([], TODAY, OPTIONS)).toEqual([]);
    });
  });

  describe('rotas', () => {
    it('exigem autenticação', async () => {
      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(401);
    });

    it('lista vazia com contador zerado para um usuário novo', async () => {
      const { token } = await newUser();
      expect(await list(token)).toEqual({ notifications: [], unreadCount: 0 });
    });

    it('gerar sem dados não falha', async () => {
      const { token } = await newUser();
      expect(await generate(token)).toEqual({ success: true, active: 0 });
    });

    it('gera o aviso de parcela a vencer e não o duplica ao gerar de novo', async () => {
      const { token, userId } = await newUser();
      await createDebt(userId);
      await generate(token);
      await generate(token);
      const body = await list(token);
      expect(body.notifications).toHaveLength(1);
      expect(body.notifications[0].type).toBe('debt_due');
      expect(body.notifications[0].read).toBe(false);
      expect(body.unreadCount).toBe(1);
    });

    it('um aviso lido não volta a ficar não lido ao gerar de novo', async () => {
      const { token, userId } = await newUser();
      await createDebt(userId);
      await generate(token);
      const [n] = (await list(token)).notifications;
      const read = await request(app).put(`/api/notifications/${n.id}/read`).set(auth(token));
      expect(read.status).toBe(200);
      await generate(token);
      const body = await list(token);
      expect(body.notifications[0].read).toBe(true);
      expect(body.unreadCount).toBe(0);
    });

    it('pagar a parcela resolve o aviso: ele é marcado como lido, não apagado', async () => {
      const { token, userId } = await newUser();
      const debt = await createDebt(userId);
      await generate(token);
      expect((await list(token)).unreadCount).toBe(1);

      // Parcela paga: o próximo vencimento sai da janela de aviso.
      await server.prisma.debt.update({
        where: { id: debt.id },
        data: { paidInstallments: 1, paidAmount: 25000, nextDueDate: isoFromToday(40) },
      });
      await generate(token);
      const body = await list(token);
      expect(body.notifications).toHaveLength(1);
      expect(body.notifications[0].read).toBe(true);
      expect(body.unreadCount).toBe(0);
    });

    it('parcela vencida gera debt_overdue', async () => {
      const { token, userId } = await newUser();
      await createDebt(userId, { nextDueDate: isoFromToday(-2) });
      await generate(token);
      const [n] = (await list(token)).notifications;
      expect(n.type).toBe('debt_overdue');
      expect(n.read).toBe(false);
    });

    it('isolamento: um usuário não vê nem marca as notificações de outro', async () => {
      const a = await newUser();
      const b = await newUser();
      await createDebt(a.userId);
      await generate(a.token);
      const [n] = (await list(a.token)).notifications;

      expect((await list(b.token)).notifications).toEqual([]);
      const res = await request(app).put(`/api/notifications/${n.id}/read`).set(auth(b.token));
      expect(res.status).toBe(404);
      expect((await list(a.token)).unreadCount).toBe(1);
    });

    it('marcar uma notificação inexistente devolve 404', async () => {
      const { token } = await newUser();
      const res = await request(app).put('/api/notifications/nao-existe/read').set(auth(token));
      expect(res.status).toBe(404);
    });

    it('read-all marca todas as não lidas do usuário, e só dele', async () => {
      const a = await newUser();
      const b = await newUser();
      await createDebt(a.userId);
      await createDebt(a.userId, { name: 'Financiamento', nextDueDate: isoFromToday(-1) });
      await createDebt(b.userId);
      await generate(a.token);
      await generate(b.token);
      expect((await list(a.token)).unreadCount).toBe(2);

      const res = await request(app).put('/api/notifications/read-all').set(auth(a.token));
      expect(res.status).toBe(200);
      expect(res.body.changes).toBe(2);
      expect((await list(a.token)).unreadCount).toBe(0);
      expect((await list(b.token)).unreadCount).toBe(1);
    });
  });
});
