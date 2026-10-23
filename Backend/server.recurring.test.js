// @vitest-environment node
// FIN-057 (parte 2/2) — CRUD, isolamento e, principalmente, o lançamento de ocorrências
// pendentes (`POST /api/recurring-transactions/process`, FIN-054): cálculo da próxima
// ocorrência por frequência, recuperação de ocorrências atrasadas e idempotência.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from './test/backend-test-utils.js';

/** Data local de hoje em ISO — mesma convenção de `todayISO` no server. */
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Hoje deslocado em `days` dias (negativo = passado), em ISO. */
function daysFromToday(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Dia 1 do mês `n` meses atrás. Usar sempre o dia 1 mantém os testes determinísticos
 * independentemente do dia em que a suíte rodar (o dia 31, por exemplo, não existe em
 * todos os meses e faria a contagem de ocorrências variar).
 */
function firstOfMonthsAgo(n) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

describe('/api/recurring-transactions', () => {
  let app;
  let cleanup;
  let tokenA;
  let tokenB;

  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('recurring'));

    const regA = await request(app).post('/api/auth/sign-up/email')
      .send({ name: 'Usuario A', email: 'usera@recurring.test', password: 'senha123' });
    expect(regA.status).toBe(200);
    tokenA = regA.body.token;

    const regB = await request(app).post('/api/auth/sign-up/email')
      .send({ name: 'Usuario B', email: 'userb@recurring.test', password: 'senha123' });
    expect(regB.status).toBe(200);
    tokenB = regB.body.token;
  });

  afterAll(() => cleanup());

  describe('CRUD e validação', () => {
    it('cria uma recorrência válida, ativa por padrão', async () => {
      const res = await request(app).post('/api/recurring-transactions').set(auth(tokenA))
        .send({ name: 'Aluguel', category: 'Moradia', amount: -150000, frequency: 'monthly', nextOccurrence: '2099-01-05' });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      expect(res.body.active).toBe(true);
      expect(res.body.amount).toBe(-150000);
    });

    it('rejeita valor zero (lançamento sem efeito a cada ocorrência)', async () => {
      const res = await request(app).post('/api/recurring-transactions').set(auth(tokenA))
        .send({ name: 'Nada', category: 'Outros', amount: 0, frequency: 'monthly', nextOccurrence: '2099-01-05' });
      expect(res.status).toBe(400);
    });

    it('rejeita frequência desconhecida', async () => {
      const res = await request(app).post('/api/recurring-transactions').set(auth(tokenA))
        .send({ name: 'Estranho', category: 'Outros', amount: -100, frequency: 'daily', nextOccurrence: '2099-01-05' });
      expect(res.status).toBe(400);
    });

    it('rejeita data fora do formato YYYY-MM-DD', async () => {
      const res = await request(app).post('/api/recurring-transactions').set(auth(tokenA))
        .send({ name: 'Estranho', category: 'Outros', amount: -100, frequency: 'monthly', nextOccurrence: '05/01/2099' });
      expect(res.status).toBe(400);
    });

    it('atualiza e exclui a própria recorrência', async () => {
      const created = await request(app).post('/api/recurring-transactions').set(auth(tokenA))
        .send({ name: 'Netflix', category: 'Lazer', amount: -5590, frequency: 'monthly', nextOccurrence: '2099-02-10' });
      expect(created.status).toBe(200);

      const upd = await request(app).put(`/api/recurring-transactions/${created.body.id}`).set(auth(tokenA))
        .send({ active: false });
      expect(upd.status).toBe(200);
      expect(upd.body.changes).toBe(1);

      const del = await request(app).delete(`/api/recurring-transactions/${created.body.id}`).set(auth(tokenA));
      expect(del.status).toBe(200);

      const list = await request(app).get('/api/recurring-transactions').set(auth(tokenA));
      expect(list.body.find(r => r.id === created.body.id)).toBeUndefined();
    });

    it('exige autenticação', async () => {
      const res = await request(app).get('/api/recurring-transactions');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /process — lançamento de ocorrências pendentes', () => {
    /** Cria uma recorrência para o usuário A e devolve o registro criado. */
    async function criarRecorrencia(overrides) {
      const res = await request(app).post('/api/recurring-transactions').set(auth(tokenA))
        .send({ name: 'Recorrência', category: 'Outros', amount: -1000, frequency: 'monthly', nextOccurrence: todayISO(), ...overrides });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      return res.body;
    }

    /** Transações do usuário A com um dado nome — usado para contar o que foi lançado. */
    async function transacoesPorNome(nome) {
      const res = await request(app).get('/api/transactions').set(auth(tokenA));
      expect(res.status).toBe(200);
      return res.body.filter(t => t.name === nome);
    }

    /** Estado atual de uma recorrência do usuário A. */
    async function recorrencia(id) {
      const res = await request(app).get('/api/recurring-transactions').set(auth(tokenA));
      return res.body.find(r => r.id === id);
    }

    it('lança a ocorrência de hoje e avança o ponteiro um mês (frequência mensal)', async () => {
      const rec = await criarRecorrencia({ name: 'Salário', category: 'Receita', amount: 500000, nextOccurrence: todayISO() });

      const res = await request(app).post('/api/recurring-transactions/process').set(auth(tokenA));
      expect(res.status).toBe(200);
      expect(res.body.processed).toBeGreaterThanOrEqual(1);

      const lancadas = await transacoesPorNome('Salário');
      expect(lancadas).toHaveLength(1);
      expect(lancadas[0].amount).toBe(500000);
      expect(lancadas[0].category).toBe('Receita');
      expect(lancadas[0].date).toBe(todayISO());

      const atualizada = await recorrencia(rec.id);
      expect(atualizada.nextOccurrence > todayISO()).toBe(true);
    });

    it('devedor vinculado a uma dívida: a dívida tem que ser do usuário, e quitada ele não é mais lançado', async () => {
      const conta = await request(app).post('/api/accounts').set(auth(tokenA))
        .send({ name: 'Conta', bank: 'Banco D', type: 'checking', balance: 0, color: '#fff' });
      const novaDivida = extra => request(app).post('/api/debts').set(auth(tokenA)).send({
        name: 'Alternador', category: 'Pessoal', totalAmount: 20000, monthlyPayment: 10000, totalInstallments: 2,
        nextDueDate: todayISO(), accountId: conta.body.id, ...extra,
      });
      const aberta = await novaDivida({});
      const quitada = await novaDivida({ name: 'Quitada', paidAmount: 20000, paidInstallments: 2 });
      expect([aberta.status, quitada.status]).toEqual([200, 200]);

      const deOutro = await request(app).post('/api/recurring-transactions').set(auth(tokenB))
        .send({ name: 'Intruso', category: 'Receita', amount: 10000, frequency: 'monthly', nextOccurrence: todayISO(), debtId: aberta.body.id });
      expect(deOutro.status).toBe(400);

      await criarRecorrencia({ name: 'Paga a aberta', category: 'Receita', amount: 10000, debtId: aberta.body.id });
      await criarRecorrencia({ name: 'Paga a quitada', category: 'Receita', amount: 10000, debtId: quitada.body.id });
      await request(app).post('/api/recurring-transactions/process').set(auth(tokenA));
      expect(await transacoesPorNome('Paga a aberta')).toHaveLength(1);
      expect(await transacoesPorNome('Paga a quitada')).toHaveLength(0);

      // Excluir a dívida só desfaz o vínculo.
      await request(app).delete(`/api/debts/${aberta.body.id}`).set(auth(tokenA));
      const lista = await request(app).get('/api/recurring-transactions').set(auth(tokenA));
      expect(lista.body.find(r => r.name === 'Paga a aberta').debtId).toBeNull();
    });

    it('devedor de uma cobrança: lança só os pagamentos que faltam e para no último', async () => {
      // 4 ocorrências vencidas (meses -3 a 0), mas faltam só 3 pagamentos.
      const rec = await criarRecorrencia({
        name: 'Maria (cartão)', category: 'Receita', amount: 15000, nextOccurrence: firstOfMonthsAgo(3),
        remainingPayments: 3, chargeName: 'Loja X · 3x',
      });
      expect(rec.chargeName).toBe('Loja X · 3x');

      await request(app).post('/api/recurring-transactions/process').set(auth(tokenA));
      expect(await transacoesPorNome('Maria (cartão)')).toHaveLength(3);
      expect((await recorrencia(rec.id)).remainingPayments).toBe(0);

      // Pagou tudo: processar de novo não lança mais nada.
      await request(app).post('/api/recurring-transactions/process').set(auth(tokenA));
      expect(await transacoesPorNome('Maria (cartão)')).toHaveLength(3);

      // Sem limite (null), lança todas as vencidas.
      await criarRecorrencia({ name: 'Sem limite', category: 'Receita', amount: 15000, nextOccurrence: firstOfMonthsAgo(3), remainingPayments: null });
      await request(app).post('/api/recurring-transactions/process').set(auth(tokenA));
      expect(await transacoesPorNome('Sem limite')).toHaveLength(4);
    });

    describe('Confirmar pagamento: o PIX recebido é o pagamento do devedor', () => {
      let conta;
      let cartao;

      beforeAll(async () => {
        conta = (await request(app).post('/api/accounts').set(auth(tokenA))
          .send({ name: 'Corrente PIX', bank: 'Banco P', type: 'checking', balance: 0, color: '#fff' })).body;
        cartao = (await request(app).post('/api/accounts').set(auth(tokenA))
          .send({ name: 'Cartão PIX', bank: 'Banco P', type: 'credit', balance: 0, color: '#fff' })).body;
      });

      /** PIX recebido (ou outra entrada) na conta corrente, salvo indicação. */
      async function receberPix(amount, date, extra = {}) {
        const res = await request(app).post('/api/transactions').set(auth(tokenA))
          .send({ name: 'PIX recebido', category: 'Transferências', date, amount, accountId: conta.id, ...extra });
        expect(res.status).toBe(200);
        return res.body;
      }

      async function transacao(id) {
        const res = await request(app).get('/api/transactions').set(auth(tokenA));
        return res.body.find(t => t.id === id);
      }

      const processar = () => request(app).post('/api/recurring-transactions/process').set(auth(tokenA));
      const confirmar = (recId, transactionId, token = tokenA) => request(app)
        .post(`/api/recurring-transactions/${recId}/confirm-payment`).set(auth(token)).send({ transactionId });

      it('sem confirmar, o PIX não dá baixa sozinho', async () => {
        const rec = await criarRecorrencia({ name: 'Sem confirmar', category: 'Receita', amount: 31600, nextOccurrence: daysFromToday(3) });
        const pix = await receberPix(31600, todayISO());
        await processar();
        expect((await transacao(pix.id)).recurringId).toBeNull();
        expect((await recorrencia(rec.id)).nextOccurrence).toBe(daysFromToday(3));
      });

      it('pago adiantado: marca o PIX, avança o vencimento e conta um pagamento', async () => {
        const rec = await criarRecorrencia({ name: 'Adiantado', category: 'Receita', amount: 31700, nextOccurrence: daysFromToday(5), remainingPayments: 3 });
        const pix = await receberPix(31700, todayISO());

        expect((await confirmar(rec.id, pix.id)).status).toBe(200);
        expect((await transacao(pix.id)).recurringId).toBe(rec.id);
        const atualizada = await recorrencia(rec.id);
        expect(atualizada.nextOccurrence > daysFromToday(5)).toBe(true);
        expect(atualizada.remainingPayments).toBe(2);
        expect(await transacoesPorNome('Adiantado')).toHaveLength(0);
      });

      it('receita prevista já lançada: ela sai e fica o PIX, sem avançar de novo o vencimento', async () => {
        const rec = await criarRecorrencia({ name: 'Já lançada', category: 'Receita', amount: 31900, nextOccurrence: daysFromToday(-3) });
        await processar();
        expect(await transacoesPorNome('Já lançada')).toHaveLength(1);
        const vencimento = (await recorrencia(rec.id)).nextOccurrence;

        const pix = await receberPix(31900, todayISO());
        expect((await confirmar(rec.id, pix.id)).status).toBe(200);
        expect(await transacoesPorNome('Já lançada')).toHaveLength(0);
        expect((await transacao(pix.id)).recurringId).toBe(rec.id);
        expect((await recorrencia(rec.id)).nextOccurrence).toBe(vencimento);
      });

      it('recusa: outro valor, transferência própria, estorno no cartão, PIX já usado, devedor de outro usuário', async () => {
        const rec = await criarRecorrencia({ name: 'Recusa', category: 'Receita', amount: 32000, nextOccurrence: todayISO() });
        const outroValor = await receberPix(32001, todayISO());
        const propria = await receberPix(32000, todayISO(), { category: 'Transferência entre contas' });
        const estorno = await receberPix(32000, todayISO(), { accountId: cartao.id });
        for (const t of [outroValor, propria, estorno]) expect((await confirmar(rec.id, t.id)).status).toBe(400);

        const pix = await receberPix(32000, todayISO());
        expect((await confirmar(rec.id, pix.id, tokenB)).status).toBe(404);
        expect((await confirmar(rec.id, pix.id)).status).toBe(200);
        expect((await confirmar(rec.id, pix.id)).status).toBe(400);
      });

      it('excluir o devedor só desfaz o vínculo do PIX', async () => {
        const rec = await criarRecorrencia({ name: 'Excluído', category: 'Receita', amount: 32100, nextOccurrence: todayISO() });
        const pix = await receberPix(32100, todayISO());
        await confirmar(rec.id, pix.id);
        await request(app).delete(`/api/recurring-transactions/${rec.id}`).set(auth(tokenA));
        expect((await transacao(pix.id)).recurringId).toBeNull();
      });
    });

    it('rejeita número de pagamentos negativo', async () => {
      const res = await request(app).post('/api/recurring-transactions').set(auth(tokenA))
        .send({ name: 'Negativo', category: 'Receita', amount: 100, frequency: 'monthly', nextOccurrence: todayISO(), remainingPayments: -1 });
      expect(res.status).toBe(400);
    });

    it('recupera todas as ocorrências atrasadas de uma vez (usuário ficou meses sem abrir o app)', async () => {
      // Dia 1 de 3 meses atrás → ocorrências dos meses -3, -2, -1 e do mês corrente = 4.
      const rec = await criarRecorrencia({ name: 'Aluguel atrasado', category: 'Moradia', amount: -120000, nextOccurrence: firstOfMonthsAgo(3) });

      await request(app).post('/api/recurring-transactions/process').set(auth(tokenA));

      const lancadas = await transacoesPorNome('Aluguel atrasado');
      expect(lancadas).toHaveLength(4);
      // Uma transação por mês, todas com o mesmo valor da recorrência.
      expect(new Set(lancadas.map(t => t.date.slice(0, 7))).size).toBe(4);
      expect(lancadas.every(t => t.amount === -120000)).toBe(true);

      const atualizada = await recorrencia(rec.id);
      expect(atualizada.nextOccurrence > todayISO()).toBe(true);
    });

    it('é idempotente: processar de novo não duplica as transações já lançadas', async () => {
      await criarRecorrencia({ name: 'Internet', category: 'Moradia', amount: -9990, nextOccurrence: firstOfMonthsAgo(1) });

      await request(app).post('/api/recurring-transactions/process').set(auth(tokenA));
      const depoisDaPrimeira = await transacoesPorNome('Internet');

      await request(app).post('/api/recurring-transactions/process').set(auth(tokenA));
      await request(app).post('/api/recurring-transactions/process').set(auth(tokenA));
      const depoisDasDemais = await transacoesPorNome('Internet');

      expect(depoisDaPrimeira.length).toBeGreaterThan(0);
      expect(depoisDasDemais).toHaveLength(depoisDaPrimeira.length);
    });

    it('frequência semanal avança 7 dias por ocorrência', async () => {
      const rec = await criarRecorrencia({ name: 'Feira', category: 'Alimentação', amount: -15000, frequency: 'weekly', nextOccurrence: daysFromToday(-7) });

      await request(app).post('/api/recurring-transactions/process').set(auth(tokenA));

      // Ocorrências: 7 dias atrás e hoje.
      const lancadas = await transacoesPorNome('Feira');
      expect(lancadas).toHaveLength(2);
      expect(lancadas.map(t => t.date).sort()).toEqual([daysFromToday(-7), todayISO()].sort());

      const atualizada = await recorrencia(rec.id);
      expect(atualizada.nextOccurrence).toBe(daysFromToday(7));
    });

    it('frequência anual avança para o ano seguinte', async () => {
      const rec = await criarRecorrencia({ name: 'IPVA', category: 'Transporte', amount: -80000, frequency: 'yearly', nextOccurrence: todayISO() });

      await request(app).post('/api/recurring-transactions/process').set(auth(tokenA));

      const lancadas = await transacoesPorNome('IPVA');
      expect(lancadas).toHaveLength(1);

      const atualizada = await recorrencia(rec.id);
      expect(Number(atualizada.nextOccurrence.slice(0, 4))).toBe(new Date().getFullYear() + 1);
    });

    it('recorrência com data futura não é lançada nem tem o ponteiro alterado', async () => {
      const rec = await criarRecorrencia({ name: 'Seguro futuro', category: 'Outros', amount: -30000, nextOccurrence: '2099-05-10' });

      await request(app).post('/api/recurring-transactions/process').set(auth(tokenA));

      expect(await transacoesPorNome('Seguro futuro')).toHaveLength(0);
      const atualizada = await recorrencia(rec.id);
      expect(atualizada.nextOccurrence).toBe('2099-05-10');
    });

    it('recorrência pausada (active=false) não gera lançamentos', async () => {
      const rec = await criarRecorrencia({ name: 'Academia pausada', category: 'Saúde', amount: -12000, nextOccurrence: firstOfMonthsAgo(2) });
      const pausa = await request(app).put(`/api/recurring-transactions/${rec.id}`).set(auth(tokenA)).send({ active: false });
      expect(pausa.status).toBe(200);

      await request(app).post('/api/recurring-transactions/process').set(auth(tokenA));

      expect(await transacoesPorNome('Academia pausada')).toHaveLength(0);
      const atualizada = await recorrencia(rec.id);
      expect(atualizada.nextOccurrence).toBe(firstOfMonthsAgo(2));
    });

    it('propaga a conta vinculada para as transações lançadas', async () => {
      const conta = await request(app).post('/api/accounts').set(auth(tokenA))
        .send({ name: 'Conta Corrente', bank: 'Banco A', type: 'checking', balance: 100000, color: '#fff' });
      expect(conta.status).toBe(200);

      await criarRecorrencia({ name: 'Assinatura com conta', category: 'Lazer', amount: -2500, nextOccurrence: todayISO(), accountId: conta.body.id });
      await request(app).post('/api/recurring-transactions/process').set(auth(tokenA));

      const lancadas = await transacoesPorNome('Assinatura com conta');
      expect(lancadas).toHaveLength(1);
      expect(lancadas[0].accountId).toBe(conta.body.id);
    });

    it('processa apenas as recorrências do próprio usuário', async () => {
      await criarRecorrencia({ name: 'Só do A', category: 'Outros', amount: -4200, nextOccurrence: todayISO() });

      // B processa as suas (nenhuma vencida) — não pode lançar nada do A.
      const resB = await request(app).post('/api/recurring-transactions/process').set(auth(tokenB));
      expect(resB.status).toBe(200);
      expect(resB.body.processed).toBe(0);

      const txsB = await request(app).get('/api/transactions').set(auth(tokenB));
      expect(txsB.body.find(t => t.name === 'Só do A')).toBeUndefined();
    });
  });

  describe('isolamento entre usuários', () => {
    let recId;

    beforeAll(async () => {
      const res = await request(app).post('/api/recurring-transactions').set(auth(tokenA))
        .send({ name: 'Recorrência de A', category: 'Outros', amount: -7700, frequency: 'monthly', nextOccurrence: '2099-09-09' });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      recId = res.body.id;
    });

    it('usuário B não vê a recorrência de A na listagem', async () => {
      const res = await request(app).get('/api/recurring-transactions').set(auth(tokenB));
      expect(res.body.find(r => r.id === recId)).toBeUndefined();
    });

    it('usuário B não consegue editar a recorrência de A (no-op, não erro)', async () => {
      const res = await request(app).put(`/api/recurring-transactions/${recId}`).set(auth(tokenB))
        .send({ amount: -1 });
      expect(res.status).toBe(200);
      expect(res.body.changes).toBe(0);

      const check = await request(app).get('/api/recurring-transactions').set(auth(tokenA));
      expect(check.body.find(r => r.id === recId).amount).toBe(-7700);
    });

    it('usuário B não consegue excluir a recorrência de A', async () => {
      await request(app).delete(`/api/recurring-transactions/${recId}`).set(auth(tokenB));
      const check = await request(app).get('/api/recurring-transactions').set(auth(tokenA));
      expect(check.body.find(r => r.id === recId)).toBeDefined();
    });
  });
});
