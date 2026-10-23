import express from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';
import { sendInternalError, validateBody } from '../lib/http.js';
import { recurringSchema, recurringUpdateSchema } from '../lib/schemas.js';
import { accountOwnershipError } from '../lib/accountAccess.js';
import { advanceOccurrence, todayISO } from '../lib/dates.js';
import { BASE_CURRENCY } from '../lib/money.js';
import { isDebtPaid } from '../lib/notificationsCore.js';
import { OWN_TRANSFER_CATEGORIES } from '../lib/pluggyHelpers.js';

export const router = express.Router();

/**
 * Chave determinística de uma ocorrência de recorrência, gravada em `Transaction.importHash`.
 * Reaproveita a constraint única `(userId, importHash)` criada em FIN-003 para tornar o
 * lançamento idempotente **no banco**, não só na aplicação: se o processamento rodar duas
 * vezes em paralelo (ex.: dois carregamentos simultâneos do dashboard, ou o duplo efeito do
 * StrictMode em dev), a segunda tentativa não cria uma transação duplicada.
 */
function recurringOccurrenceHash(userId, recurringId, occurrenceDate) {
  return crypto.createHash('sha256').update(['recurring', userId, recurringId, occurrenceDate].join('|')).digest('hex');
}

// Teto de ocorrências geradas por chamada, por recorrência. Uma recorrência semanal parada
// há anos geraria centenas de transações numa única requisição; o teto distribui isso entre
// chamadas sucessivas (o ponteiro `nextOccurrence` avança a cada uma) e também limita o
// estrago caso `advanceOccurrence` deixe de avançar por um dado inesperado.
const MAX_OCCURRENCES_PER_RUN = 120;

// Dias antes ou depois do vencimento em que um PIX recebido do mesmo valor pode ser o pagamento do
// devedor (o "Confirmar pagamento" — mesma janela em `utils/recurring.ts`). Na semanal, menos que
// meia semana, para um PIX não servir a duas ocorrências.
const PAYMENT_WINDOW_DAYS = { weekly: 3, monthly: 10, yearly: 10 };

/** Distância em dias entre duas datas ISO. */
function daysApart(a, b) {
  return Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000;
}

/** A dívida vinculada precisa ser do usuário — a chave estrangeira só garante que ela existe. */
async function recurringLinkError(userId, { accountId, debtId }) {
  const accountError = await accountOwnershipError(userId, accountId);
  if (accountError) return accountError;
  if (!debtId) return null;
  const owned = await prisma.debt.count({ where: { id: debtId, userId } });
  return owned > 0 ? null : 'Dívida vinculada não encontrada.';
}

// --- RECURRING TRANSACTIONS (FIN-054) ---
router.get('/', requireAuth, async (req, res) => {
  try {
    const recurring = await prisma.recurringTransaction.findMany({ where: { userId: req.user.userId } });
    res.json(recurring);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar recorrências.');
  }
});

router.post('/', requireAuth, async (req, res) => {
  const validation = validateBody(recurringSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const linkError = await recurringLinkError(req.user.userId, validation.data);
    if (linkError) return res.status(400).json({ error: linkError });
    const data = { active: true, ...validation.data, userId: req.user.userId };
    const recurring = await prisma.recurringTransaction.create({ data });
    res.json(recurring);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao criar recorrência.');
  }
});

/*
 * Lança as ocorrências já vencidas de todas as recorrências ativas do usuário, criando as
 * `Transaction` reais e avançando `nextOccurrence`. Declarado ANTES das rotas com `:id`
 * para que "process" nunca seja capturado como um id.
 *
 * Idempotente por construção: cada ocorrência tem um `importHash` determinístico
 * (`recurringOccurrenceHash`) protegido pela constraint única `(userId, importHash)`, e a
 * criação das transações + o avanço do ponteiro acontecem na mesma transação de banco —
 * então nunca fica uma transação lançada sem o ponteiro correspondente ter avançado, nem o
 * contrário.
 */
router.post('/process', requireAuth, async (req, res) => {
  const userId = req.user.userId;
  try {
    const today = todayISO();
    // Comparação de data em string ISO (YYYY-MM-DD) é lexicográfica = cronológica, mesma
    // convenção usada em `isDebtOverdue` no frontend.
    const dueRecurrences = await prisma.recurringTransaction.findMany({
      where: { userId, active: true, nextOccurrence: { lte: today } },
      // FIN-074: a ocorrência nasce na moeda da conta da recorrência (real, sem conta).
      include: {
        account: { select: { currency: true } },
        debt: { select: { paidAmount: true, totalAmount: true, paidInstallments: true, totalInstallments: true } },
      },
    });

    let processed = 0;
    for (const rec of dueRecurrences) {
      // Devedor de uma dívida já quitada: ele parou de pagar, então não há o que lançar.
      if (rec.debt && isDebtPaid(rec.debt)) continue;
      // Devedor de uma cobrança: lança só os pagamentos que faltam.
      const limit = Math.min(rec.remainingPayments ?? MAX_OCCURRENCES_PER_RUN, MAX_OCCURRENCES_PER_RUN);
      const ops = [];
      let occurrence = rec.nextOccurrence;

      while (occurrence <= today && ops.length < limit) {
        const importHash = recurringOccurrenceHash(userId, rec.id, occurrence);
        ops.push(prisma.transaction.upsert({
          where: { userId_importHash: { userId, importHash } },
          create: {
            userId,
            accountId: rec.accountId,
            name: rec.name,
            category: rec.category,
            date: occurrence,
            amount: rec.amount,
            currency: rec.account?.currency ?? BASE_CURRENCY,
            importHash,
          },
          // Ocorrência já lançada por uma execução anterior/concorrente: nada a fazer.
          update: {},
        }));

        const next = advanceOccurrence(occurrence, rec.frequency);
        // Proteção contra dado inesperado (frequência desconhecida, data malformada): sem
        // avanço, o laço giraria para sempre sobre a mesma ocorrência.
        if (next <= occurrence) break;
        occurrence = next;
      }

      if (ops.length === 0) continue;
      const posted = ops.length;
      ops.push(prisma.recurringTransaction.update({
        where: { id: rec.id },
        data: { nextOccurrence: occurrence, remainingPayments: rec.remainingPayments == null ? null : rec.remainingPayments - posted },
      }));
      await prisma.$transaction(ops);
      processed += posted;
    }

    // `processed` conta ocorrências processadas nesta execução. Numa reexecução rara sobre
    // as mesmas ocorrências (upsert no-op), o número reflete o que foi reprocessado, não
    // transações novas — o frontend usa apenas "> 0" para decidir se recarrega a lista.
    res.json({ success: true, processed });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao processar recorrências.');
  }
});

/*
 * "Confirmar pagamento" na aba Devedores: o PIX recebido (`transactionId`) é o pagamento do devedor.
 * Fica marcado (`Transaction.recurringId`). Se a receita prevista daquele vencimento já tinha sido
 * lançada, ela sai e fica o PIX; senão (pago adiantado), o vencimento avança e conta um pagamento.
 */
router.post('/:id/confirm-payment', requireAuth, async (req, res) => {
  const userId = req.user.userId;
  const transactionId = typeof req.body?.transactionId === 'string' ? req.body.transactionId : '';
  try {
    const rec = await prisma.recurringTransaction.findFirst({ where: { id: req.params.id, userId } });
    if (!rec || rec.amount <= 0) return res.status(404).json({ error: 'Devedor não encontrado.' });
    const pix = transactionId
      ? await prisma.transaction.findFirst({ where: { id: transactionId, userId }, include: { account: { select: { type: true } } } })
      : null;
    if (!pix) return res.status(404).json({ error: 'PIX não encontrado.' });
    if (pix.recurringId) return res.status(400).json({ error: 'Esse PIX já confirmou um pagamento.' });
    if (pix.amount !== rec.amount || pix.account?.type === 'credit' || OWN_TRANSFER_CATEGORIES.includes(pix.category)) {
      return res.status(400).json({ error: 'Esse PIX não confere com o pagamento do devedor.' });
    }

    const window = PAYMENT_WINDOW_DAYS[rec.frequency] ?? PAYMENT_WINDOW_DAYS.monthly;
    const [posted] = (await prisma.transaction.findMany({
      where: { userId, name: rec.name, amount: rec.amount, importHash: { not: null } },
      select: { id: true, date: true, importHash: true },
    }))
      .filter(t => t.importHash === recurringOccurrenceHash(userId, rec.id, t.date) && daysApart(t.date, pix.date) <= window)
      .sort((a, b) => daysApart(a.date, pix.date) - daysApart(b.date, pix.date));

    const ops = [prisma.transaction.update({ where: { id: pix.id }, data: { recurringId: rec.id } })];
    if (posted) {
      ops.push(prisma.transaction.delete({ where: { id: posted.id } }));
    } else if (rec.remainingPayments !== 0) {
      ops.push(prisma.recurringTransaction.update({
        where: { id: rec.id },
        data: {
          nextOccurrence: advanceOccurrence(rec.nextOccurrence, rec.frequency),
          remainingPayments: rec.remainingPayments == null ? null : rec.remainingPayments - 1,
        },
      }));
    }
    await prisma.$transaction(ops);
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao confirmar o pagamento.');
  }
});

router.put('/:id', requireAuth, async (req, res) => {
  const validation = validateBody(recurringUpdateSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const linkError = await recurringLinkError(req.user.userId, validation.data);
    if (linkError) return res.status(400).json({ error: linkError });
    const recurring = await prisma.recurringTransaction.updateMany({
      where: { id: req.params.id, userId: req.user.userId },
      data: validation.data,
    });
    res.json({ success: true, changes: recurring.count });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao atualizar recorrência.');
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { count } = await prisma.recurringTransaction.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    // Os PIX que ele pagou continuam; só perdem o vínculo.
    if (count > 0) await prisma.transaction.updateMany({ where: { userId: req.user.userId, recurringId: req.params.id }, data: { recurringId: null } });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir recorrência.');
  }
});
