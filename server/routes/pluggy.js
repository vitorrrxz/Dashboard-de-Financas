import express from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticateToken } from '../lib/auth.js';
import { sendInternalError } from '../lib/http.js';
import { toCents } from '../lib/money.js';
import {
  getPluggyClient, mapPluggyAccountType, pluggyReauthMessage, pluggyAmountToCents,
  isCreditCardBillPayment, pluggyTransactionCategory, pluggyCurrency, pluggyBillDueDay,
} from '../lib/pluggyHelpers.js';

export const router = express.Router();

const PLUGGY_ITEM_NOT_FOUND = 'Conexão bancária não encontrada.';

// FIN-107 — registra (ou atualiza) a conexão do usuário com um banco. `clientUserId` é o usuário do
// token com que a conexão foi feita (connect-token): a conexão de outro usuário não entra.
async function registerPluggyItem(userId, pluggyItem) {
  if (pluggyItem.clientUserId && pluggyItem.clientUserId !== userId) return false;
  const data = { providerName: pluggyItem.connector.name, status: pluggyItem.status };
  await prisma.pluggyItem.upsert({
    where: { userId_pluggyId: { userId, pluggyId: pluggyItem.id } },
    create: { userId, pluggyId: pluggyItem.id, ...data },
    update: data,
  });
  return true;
}

// FIN-107 — conexão feita antes de a tabela existir: acha o item pelas contas que ela já sincronizou.
// Só roda enquanto o usuário não tem nenhuma conexão registrada.
async function adoptLegacyPluggyItems(userId) {
  if (await prisma.pluggyItem.count({ where: { userId } })) return;
  const accounts = await prisma.account.findMany({ where: { userId, pluggyId: { not: null } }, select: { pluggyId: true } });
  const seen = new Set();
  for (const { pluggyId } of accounts) {
    try {
      const { itemId } = await getPluggyClient().fetchAccount(pluggyId);
      if (seen.has(itemId)) continue;
      seen.add(itemId);
      await registerPluggyItem(userId, await getPluggyClient().fetchItem(itemId));
    } catch (error) {
      console.error(`Conexão da conta não encontrada na Pluggy (accountId=${pluggyId}):`, error);
    }
  }
}

// FIN-107 — uma sincronização por vez por usuário: a de uma aba espera a da outra terminar.
// ponytail: fila em memória, vale para um processo só; com mais de uma instância da API, trocar por trava no banco.
const syncQueues = new Map();
function runExclusive(key, task) {
  const run = (syncQueues.get(key) ?? Promise.resolve()).then(task);
  const tail = run.catch(() => {});
  syncQueues.set(key, tail);
  tail.then(() => { if (syncQueues.get(key) === tail) syncQueues.delete(key); });
  return run;
}

// POST /api/pluggy/connect-token — Gera o token temporário para o widget
router.post('/connect-token', authenticateToken, async (req, res) => {
  try {
    const response = await getPluggyClient().createConnectToken(undefined, {
      clientUserId: req.user.userId,
    });
    res.json({ accessToken: response.accessToken });
  } catch (error) {
    sendInternalError(res, error, 'Erro ao conectar à API da Pluggy.');
  }
});

// POST /api/pluggy/connect-item — Recebe itemId do widget e registra no banco
router.post('/connect-item', authenticateToken, async (req, res) => {
  const { itemId } = req.body;
  if (!itemId) return res.status(400).json({ error: 'itemId é obrigatório.' });

  try {
    const pluggyItem = await getPluggyClient().fetchItem(itemId);
    const userId = req.user.userId;

    // FIN-107: registra a conexão, com o estado do login. Antes, uma conta de saldo zero com o id do
    // item marcava a conexão — nunca atualizada pela sincronização, que grava as contas reais.
    if (!(await registerPluggyItem(userId, pluggyItem))) {
      return res.status(404).json({ error: PLUGGY_ITEM_NOT_FOUND });
    }

    // Reporta o status do item já na conexão inicial (ver FIN-041) — um item pode nascer
    // em LOGIN_ERROR (ex. credenciais rejeitadas pelo banco na primeira tentativa).
    res.json({
      success: true,
      providerName: pluggyItem.connector.name,
      pluggyStatus: pluggyItem.status,
      statusMessage: pluggyReauthMessage(pluggyItem.status),
    });
  } catch (error) {
    sendInternalError(res, error, 'Erro ao registrar conexão bancária.');
  }
});

// Sincroniza contas e transações de uma conexão (item) da Pluggy e devolve o status HTTP e o corpo da
// resposta — a rota do botão e a sincronização automática (FIN-107) passam por aqui.
async function syncPluggyItem(userId, itemId) {
  // Verifica o status do item antes de tentar sincronizar (ver FIN-041 em
  // docs/BACKLOG_DETAIL.md) — sem isso, uma conexão que exige reautenticação
  // (LOGIN_ERROR/OUTDATED) falhava na sincronização com um erro genérico, sem indicar
  // ao usuário que a ação necessária é reconectar o banco.
  const pluggyItem = await getPluggyClient().fetchItem(itemId);
  // FIN-107: guarda o estado do login — a conexão expirada fica fora da sincronização automática.
  await prisma.pluggyItem.updateMany({ where: { userId, pluggyId: itemId }, data: { status: pluggyItem.status } });
  const reauthMessage = pluggyReauthMessage(pluggyItem.status);
  if (reauthMessage) {
    return { status: 409, body: { error: reauthMessage, pluggyStatus: pluggyItem.status } };
  }

  const accountsRes = await getPluggyClient().fetchAccounts(itemId);
  if (!accountsRes.results || accountsRes.results.length === 0) {
    return { status: 404, body: { error: 'Nenhuma conta encontrada para este item.' } };
  }

  let totalTxs = 0;
  // FIN-105: regras de categoria do usuário, lidas uma vez para a sincronização inteira.
  const categoryRules = await prisma.categoryRule.findMany({ where: { userId } });

  for (const pluggyAcc of accountsRes.results) {
    const accountType = mapPluggyAccountType(pluggyAcc);
    const accountCurrency = pluggyCurrency(pluggyAcc.currencyCode); // FIN-074
    // Upsert atômico via constraint (userId, pluggyId) — ver FIN-021.
    const localAccount = await prisma.account.upsert({
      where: { userId_pluggyId: { userId, pluggyId: pluggyAcc.id } },
      create: {
        userId,
        pluggyId: pluggyAcc.id,
        name: pluggyAcc.name,
        bank: pluggyAcc.marketingName || 'Banco Conectado',
        type: accountType,
        balance: toCents(pluggyAcc.balance),
        currency: accountCurrency,
        color: '#6366f1',
      },
      update: { balance: toCents(pluggyAcc.balance), name: pluggyAcc.name, currency: accountCurrency },
    });
    // FIN-074: as transações da conta ficam na moeda dela. Só grava se alguma estiver em
    // outra moeda — na prática, nunca depois da primeira sincronização.
    await prisma.transaction.updateMany({
      where: { userId, accountId: localAccount.id, currency: { not: accountCurrency } },
      data: { currency: accountCurrency },
    });

    // Para cartões de crédito, busca a fatura real via endpoint dedicado da Pluggy
    // e atualiza `pendingBill` — não é possível inferir a fatura a partir de `balance`
    // para contas do tipo CREDIT (ver FIN-001 em docs/BACKLOG_DETAIL.md).
    if (pluggyAcc.type === 'CREDIT') {
      try {
        const billsRes = await getPluggyClient().fetchCreditCardBills(pluggyAcc.id);
        const bills = billsRes?.results ?? [];
        if (bills.length > 0) {
          // A fatura pendente é a mais recentemente fechada (maior billClosingDate/dueDate) —
          // não a de menor data, que representaria uma fatura antiga já superada.
          const currentBill = [...bills].sort((a, b) => {
            const dateA = new Date(a.billClosingDate ?? a.dueDate).getTime();
            const dateB = new Date(b.billClosingDate ?? b.dueDate).getTime();
            return dateB - dateA;
          })[0];
          // FIN-067: o dia de vencimento vem da própria fatura. Sem ele, o aviso de fatura a
          // vencer nunca dispararia para um cartão conectado via Pluggy — o cadastro manual de
          // `dueDay` era o único caminho, e a sincronização não o preenchia.
          const dueDay = pluggyBillDueDay(currentBill);
          await prisma.account.updateMany({
            where: { id: localAccount.id, userId },
            data: { pendingBill: toCents(currentBill.totalAmount), ...(dueDay ? { dueDay } : {}) },
          });
        }
      } catch (billError) {
        console.error(`Erro ao buscar fatura do cartão (accountId=${pluggyAcc.id}):`, billError);
      }
    }

    // Busca transações do último mês, paginando até obter todas — a API da Pluggy pagina
    // por padrão (20 itens/página, máx. 500), então sem este loop uma conta com mais
    // transações que uma página perderia dados silenciosamente (ver FIN-038 em
    // docs/BACKLOG_DETAIL.md).
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const fromDate = oneMonthAgo.toISOString().split('T')[0];

    const allPluggyTxs = [];
    let page = 1;
    let totalPages = 1;
    do {
      const txsRes = await getPluggyClient().fetchTransactions(pluggyAcc.id, { from: fromDate, page, pageSize: 500 });
      allPluggyTxs.push(...txsRes.results);
      totalPages = txsRes.totalPages;
      page++;
    } while (page <= totalPages);

    // FIN-092: em conta de cartão, descarta o pagamento da própria fatura — ver
    // `isCreditCardBillPayment`. O filtro é feito aqui, antes de qualquer uso, para que
    // a query de existentes, o refresh e a inserção enxerguem todos o mesmo conjunto.
    const pluggyTxs = accountType === 'credit'
      ? allPluggyTxs.filter(tx => !isCreditCardBillPayment(tx))
      : allPluggyTxs;

    // FIN-037: busca de uma vez os `pluggyId` já existentes desta sincronização (1
    // consulta), em vez de um `findFirst` por transação (N consultas).
    const existingTxs = await prisma.transaction.findMany({
      where: { userId, pluggyId: { in: pluggyTxs.map(t => t.id) } },
      select: { pluggyId: true, name: true, date: true, amount: true, paymentType: true },
    });
    const existingByPluggyId = new Map(existingTxs.map(t => [t.pluggyId, t]));

    const newPluggyTxs = pluggyTxs.filter(tx => !existingByPluggyId.has(tx.id));
    totalTxs += newPluggyTxs.length;

    // Transações já existentes: a Pluggy pode reportar valor/descrição/data diferentes
    // numa sincronização posterior (ex.: transação que estava pendente e "assentou" com
    // valor final diferente do provisório) — sem isto o app ficaria com dados
    // desatualizados indefinidamente após a primeira sincronização. Só grava (1 UPDATE)
    // quando algo realmente mudou, então o custo extra é próximo de zero na maioria das
    // sincronizações (poucas transações do último mês mudam de um sync para o outro).
    for (const tx of pluggyTxs) {
      const existing = existingByPluggyId.get(tx.id);
      if (!existing) continue;
      const freshDate = tx.date.toISOString().split('T')[0];
      const freshAmount = pluggyAmountToCents(tx, accountType);
      const freshPaymentType = accountType === 'credit' ? 'credit' : 'debit';
      if (
        existing.name !== tx.description || existing.date !== freshDate ||
        existing.amount !== freshAmount || existing.paymentType !== freshPaymentType
      ) {
        await prisma.transaction.updateMany({
          where: { userId, pluggyId: tx.id },
          data: { name: tx.description, date: freshDate, amount: freshAmount, paymentType: freshPaymentType },
        });
      }
    }

    if (newPluggyTxs.length > 0) {
      const data = newPluggyTxs.map(tx => ({
        userId,
        accountId: localAccount.id,
        pluggyId: tx.id,
        name: tx.description,
        category: pluggyTransactionCategory(tx, categoryRules),
        date: tx.date.toISOString().split('T')[0],
        amount: pluggyAmountToCents(tx, accountType),
        currency: accountCurrency, // FIN-074
        // Deixa explícito na transação que ela veio de um cartão — é o que o app já
        // exibe na lista, e serve de marca de que o sinal foi normalizado (FIN-092).
        paymentType: accountType === 'credit' ? 'credit' : 'debit',
      }));
      try {
        await prisma.transaction.createMany({ data });
      } catch (err) {
        // Corrida rara: outra sincronização inseriu a mesma transação entre o
        // `findMany` acima e este `createMany` (que, ao contrário de `create`
        // individual, falha inteiro — não por linha — ao violar a constraint única, e
        // o SQLite não suporta `skipDuplicates` no Prisma). Cai para upsert linha a
        // linha só neste caso raro, protegido pela constraint (ver FIN-021) — e também
        // atualiza os dados no conflito, para ficar consistente com o loop de refresh acima.
        if (err.code === 'P2002') {
          for (const t of data) {
            await prisma.transaction.upsert({
              where: { userId_pluggyId: { userId, pluggyId: t.pluggyId } },
              create: t,
              update: { name: t.name, date: t.date, amount: t.amount, paymentType: t.paymentType, currency: t.currency },
            });
          }
        } else {
          throw err;
        }
      }
    }

    // Nota: reconciliação de transações removidas/substituídas do lado da Pluggy (ex.:
    // uma transação pendente que desaparece e é substituída por outra com ID diferente)
    // fica fora do escopo desta correção — exigiria comparar todo o histórico já
    // importado contra a janela de datas retornada pela Pluggy para decidir com segurança
    // o que apagar, e um erro nessa lógica apagaria transações reais do usuário. Preferível
    // tratar como item de backlog dedicado a ser desenhado com mais cuidado.
  }

  // FIN-107: a hora da última sincronização, mostrada na tela e usada pela automática.
  await prisma.pluggyItem.updateMany({ where: { userId, pluggyId: itemId }, data: { lastSyncAt: new Date() } });
  return { status: 200, body: { success: true, message: `Sincronizacao concluida! ${totalTxs} novas transacoes importadas.` } };
}

// POST /api/pluggy/sync/:itemId — Sincroniza contas e transações do banco conectado
router.post('/sync/:itemId', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    // FIN-107: só a conexão registrada para o próprio usuário, e uma sincronização por vez.
    const item = await prisma.pluggyItem.findUnique({ where: { userId_pluggyId: { userId, pluggyId: req.params.itemId } } });
    if (!item) return res.status(404).json({ error: PLUGGY_ITEM_NOT_FOUND });
    const { status, body } = await runExclusive(userId, () => syncPluggyItem(userId, item.pluggyId));
    res.status(status).json(body);
  } catch (error) {
    sendInternalError(res, error, 'Erro na sincronização de dados.');
  }
});

// POST /api/pluggy/auto-sync — FIN-107: chamada ao abrir o app. Sincroniza as conexões paradas há mais
// de 6 h, menos a de login expirado (FIN-041), e devolve a lista para a tela mostrar a hora da última
// sincronização. A falha de uma conexão fica no log e não impede as outras nem a resposta.
const AUTO_SYNC_AFTER_MS = 6 * 60 * 60 * 1000;
router.post('/auto-sync', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const synced = await runExclusive(userId, async () => {
      await adoptLegacyPluggyItems(userId);
      let count = 0;
      // Lido já dentro da fila: a aba que esperou a outra terminar vê a conexão recém-sincronizada.
      for (const item of await prisma.pluggyItem.findMany({ where: { userId } })) {
        const stale = !item.lastSyncAt || Date.now() - item.lastSyncAt.getTime() >= AUTO_SYNC_AFTER_MS;
        if (!stale || item.status === 'LOGIN_ERROR') continue;
        try {
          if ((await syncPluggyItem(userId, item.pluggyId)).status === 200) count++;
        } catch (error) {
          console.error(`Falha na sincronização automática (itemId=${item.pluggyId}):`, error);
        }
      }
      return count;
    });
    const items = await prisma.pluggyItem.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { pluggyId: true, providerName: true, status: true, lastSyncAt: true },
    });
    res.json({ synced, items });
  } catch (error) {
    sendInternalError(res, error, 'Erro na sincronização automática.');
  }
});
