import express from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticateToken } from '../lib/auth.js';
import { sendInternalError } from '../lib/http.js';
import { shiftMonthKey, todayISO } from '../lib/dates.js';
import { BASE_CURRENCY } from '../lib/money.js';
import { NOTIFICATION_SETTINGS, buildDueNotifications, detectUnusualSpending } from '../lib/notificationsCore.js';

export const router = express.Router();

// --- NOTIFICATIONS (FIN-065 a FIN-069) ---

// Quantas notificações a listagem devolve. A central mostra as mais recentes; o total de não
// lidas vem à parte (`unreadCount`), então o limite nunca esconde nada do contador do sino.
const NOTIFICATIONS_PAGE_SIZE = 50;

// Tipos cujo aviso deixa de valer quando a ocorrência sai de cena: a parcela foi paga, ou o
// "vence em" virou "venceu" (outro aviso, com outra chave). Faturas ficam de fora — não há
// como saber se foram pagas, então o aviso só sai do contador quando o usuário o lê — e os
// alertas de gasto incomum também, porque são informativos e valem para o mês inteiro.
const RECONCILED_NOTIFICATION_TYPES = ['debt_due', 'debt_overdue'];

router.get('/', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: [{ read: 'asc' }, { createdAt: 'desc' }],
        take: NOTIFICATIONS_PAGE_SIZE,
      }),
      prisma.notification.count({ where: { userId, read: false } }),
    ]);
    res.json({ notifications, unreadCount });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar notificações.');
  }
});

/*
 * Gera as notificações automáticas — vencimentos (FIN-067) e gasto incomum (FIN-069) — a
 * partir do estado atual das dívidas, cartões e transações. O frontend chama ao carregar o
 * app e sempre que esses dados mudam. Declarado antes das rotas com `:id`, pelo mesmo motivo
 * de `/recurring-transactions/process`.
 *
 * Idempotente no banco: cada aviso tem uma `dedupeKey` protegida pela constraint única
 * `(userId, dedupeKey)`, e o upsert atualiza só título e mensagem — nunca `read`, para que um
 * aviso já lido não volte a acender o sino. Tudo numa transação, junto da reconciliação.
 */
router.post('/generate', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const today = todayISO();
    const settings = NOTIFICATION_SETTINGS;
    const baselineStart = `${shiftMonthKey(today.slice(0, 7), -settings.unusualSpendingMonths)}-01`;

    const [debts, creditAccounts, recentTransactions, firstTransaction] = await Promise.all([
      prisma.debt.findMany({ where: { userId } }),
      prisma.account.findMany({ where: { userId, type: 'credit' } }),
      // FIN-074: só transações em real — somar dólares e reais na mesma categoria distorceria a
      // média e o gasto do mês. Gasto em moeda estrangeira fica fora deste alerta.
      prisma.transaction.findMany({
        where: { userId, currency: BASE_CURRENCY, date: { gte: baselineStart, lte: today } },
        select: { date: true, amount: true, category: true },
      }),
      // O início do histórico decide quais meses da média estão completos — ver
      // `detectUnusualSpending`. Precisa ser o de TODAS as transações, não só as da janela.
      prisma.transaction.findFirst({ where: { userId }, orderBy: { date: 'asc' }, select: { date: true } }),
    ]);

    const candidates = [
      ...buildDueNotifications(debts, creditAccounts, today, settings.dueSoonDays),
      ...detectUnusualSpending(recentTransactions, today, {
        months: settings.unusualSpendingMonths,
        threshold: settings.unusualSpendingThreshold,
        minCents: settings.unusualSpendingMinCents,
        historyStart: firstTransaction?.date,
      }),
    ];

    await prisma.$transaction([
      ...candidates.map(candidate => prisma.notification.upsert({
        where: { userId_dedupeKey: { userId, dedupeKey: candidate.dedupeKey } },
        create: { userId, ...candidate },
        update: { title: candidate.title, message: candidate.message },
      })),
      // Reconciliação não destrutiva: marca como lidos (nunca apaga) os avisos de dívida cuja
      // ocorrência não está mais entre as candidatas — parcela paga, dívida quitada ou
      // excluída, ou "vence em" que virou "venceu". Sem isso o sino continuaria aceso por algo
      // que já foi resolvido.
      prisma.notification.updateMany({
        where: {
          userId,
          read: false,
          type: { in: RECONCILED_NOTIFICATION_TYPES },
          dedupeKey: { notIn: candidates.map(c => c.dedupeKey) },
        },
        data: { read: true },
      }),
    ]);

    res.json({ success: true, active: candidates.length });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao gerar notificações.');
  }
});

router.put('/read-all', authenticateToken, async (req, res) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user.userId, read: false },
      data: { read: true },
    });
    res.json({ success: true, changes: result.count });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao marcar notificações como lidas.');
  }
});

router.put('/:id/read', authenticateToken, async (req, res) => {
  try {
    // `userId` no filtro: a notificação de outro usuário simplesmente não é encontrada, e a
    // resposta é a mesma de um id inexistente — não revela que o id existe (ver FIN-032).
    const result = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user.userId },
      data: { read: true },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Notificação não encontrada.' });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao marcar notificação como lida.');
  }
});
