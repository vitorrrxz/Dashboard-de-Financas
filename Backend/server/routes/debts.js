import express from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';
import { sendInternalError, validateBody } from '../lib/http.js';
import { debtCreateSchema, debtUpdateSchema } from '../lib/schemas.js';
import { accountOwnershipError } from '../lib/accountAccess.js';
import { advanceOccurrence } from '../lib/dates.js';
import { formatCentsBRL } from '../lib/money.js';

export const router = express.Router();

// Partes do pagamento na ordem do mês.
const DEBT_INCLUDE = { subItems: true, splits: { orderBy: [{ day: 'asc' }, { id: 'asc' }] } };

/** As partes têm de somar a parcela mensal. Devolve a mensagem de erro, ou `null`. */
function splitsSumError(splits, monthlyPayment) {
  if (!splits?.length) return null;
  const sum = splits.reduce((s, part) => s + part.amount, 0);
  return sum === monthlyPayment ? null
    : `As partes somam ${formatCentsBRL(sum)}, mas a parcela mensal é ${formatCentsBRL(monthlyPayment)}.`;
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const debts = await prisma.debt.findMany({
      where: { userId: req.user.userId },
      include: DEBT_INCLUDE
    });
    res.json(debts);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar dívidas.');
  }
});

router.post('/', requireAuth, async (req, res) => {
  const validation = validateBody(debtCreateSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  const splitError = splitsSumError(validation.data.splits, validation.data.monthlyPayment);
  if (splitError) return res.status(400).json({ error: splitError });
  try {
    const accountError = await accountOwnershipError(req.user.userId, validation.data.accountId);
    if (accountError) return res.status(400).json({ error: accountError });
    const { subItems, splits, ...rest } = validation.data;
    // paidAmount/paidInstallments são opcionais no schema (para não forçar reset a 0 em
    // updates parciais via debtUpdateSchema, que reaproveita o mesmo schema base) — mas
    // no create, se ausentes, uma dívida nova sempre começa em 0.
    const data = { paidAmount: 0, paidInstallments: 0, ...rest, userId: req.user.userId };

    const debt = await prisma.debt.create({
      data: {
        ...data,
        subItems: subItems ? { create: subItems.map(s => ({ name: s.name, amount: s.amount, date: s.date })) } : undefined,
        splits: splits?.length ? { create: splits.map(({ day, amount }) => ({ day, amount })) } : undefined,
      },
      include: DEBT_INCLUDE
    });
    res.json(debt);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao criar dívida.');
  }
});

router.put('/:id', requireAuth, async (req, res) => {
  const validation = validateBody(debtUpdateSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const accountError = await accountOwnershipError(req.user.userId, validation.data.accountId);
    if (accountError) return res.status(400).json({ error: accountError });
    const { id } = req.params;
    const { subItems: _subItems, splits, ...data } = validation.data;

    // Divisão ou parcela mudando: as partes (as novas, ou as que já existem) têm de somar a parcela.
    let replaceSplits;
    if (splits !== undefined || data.monthlyPayment !== undefined) {
      const current = await prisma.debt.findFirst({ where: { id, userId: req.user.userId }, include: { splits: true } });
      if (!current) return res.status(404).json({ error: 'Dívida não encontrada.' });
      const splitError = splitsSumError(splits ?? current.splits, data.monthlyPayment ?? current.monthlyPayment);
      if (splitError) return res.status(400).json({ error: splitError });
      if (splits !== undefined) {
        // Parte já paga neste mês continua paga se ficou igual (mesmo dia e valor): refazer a
        // divisão não pode deixar pagar de novo o que já entrou em `paidAmount`.
        const paidLeft = current.splits.filter(part => part.paid);
        replaceSplits = {
          deleteMany: {},
          create: splits.map(({ day, amount }) => {
            const match = paidLeft.findIndex(part => part.day === day && part.amount === amount);
            if (match >= 0) paidLeft.splice(match, 1);
            return { day, amount, paid: match >= 0 };
          }),
        };
      }
    }

    const debt = await prisma.debt.update({
      where: { id, userId: req.user.userId },
      data: { ...data, splits: replaceSplits },
      include: DEBT_INCLUDE
    });
    res.json(debt);
  } catch (err) {
    // P2025 = nenhum registro encontrado com esse `where` (id + userId) — ou a dívida não
    // existe, ou pertence a outro usuário. Mesmo comportamento de "não encontrado" que
    // accounts/transactions dão via updateMany (changes:0), só que aqui `update` lança em
    // vez de simplesmente não afetar linhas — sem este catch, cairia em 500 (ver FIN-032).
    if (err.code === 'P2025') return res.status(404).json({ error: 'Dívida não encontrada.' });
    sendInternalError(res, err, 'Erro ao atualizar dívida.');
  }
});

/**
 * Paga uma parte da parcela do mês: soma o valor ao pago e marca a parte. Na última parte que
 * faltava (ou na que quita a dívida), a parcela avança como em `computeNextInstallment` (frontend) — mais uma paga, vencimento
 * no mês seguinte, e a última parcela fecha o total — e as partes voltam a "não paga".
 */
router.post('/:id/splits/:splitId/pay', requireAuth, async (req, res) => {
  try {
    const debt = await prisma.debt.findFirst({ where: { id: req.params.id, userId: req.user.userId }, include: { splits: true } });
    const split = debt?.splits.find(part => part.id === req.params.splitId);
    if (!split) return res.status(404).json({ error: 'Parte do pagamento não encontrada.' });
    if (debt.paidAmount >= debt.totalAmount || debt.paidInstallments >= debt.totalInstallments) {
      return res.status(400).json({ error: 'Essa dívida já está quitada.' });
    }
    if (split.paid) return res.status(400).json({ error: 'Essa parte já foi paga neste mês.' });

    let paidAmount = Math.min(debt.paidAmount + split.amount, debt.totalAmount);
    // A parcela fecha com a última parte do mês, ou antes, se a parte já quitou a dívida (a última
    // parcela pode ser menor que a mensal).
    const monthDone = paidAmount >= debt.totalAmount || debt.splits.every(part => part.paid || part.id === split.id);
    const ops = [];
    if (monthDone) {
      const paidInstallments = debt.paidInstallments + 1;
      if (paidInstallments >= debt.totalInstallments) paidAmount = debt.totalAmount;
      ops.push(
        prisma.debtSplit.updateMany({ where: { debtId: debt.id }, data: { paid: false } }),
        prisma.debt.update({
          where: { id: debt.id },
          data: { paidAmount, paidInstallments, nextDueDate: advanceOccurrence(debt.nextDueDate, 'monthly') },
          include: DEBT_INCLUDE,
        }),
      );
    } else {
      ops.push(
        prisma.debtSplit.update({ where: { id: split.id }, data: { paid: true } }),
        prisma.debt.update({ where: { id: debt.id }, data: { paidAmount }, include: DEBT_INCLUDE }),
      );
    }
    const results = await prisma.$transaction(ops);
    res.json(results[results.length - 1]);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao pagar a parte da dívida.');
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    // Delete subitems first via cascading or manual delete due to sqlite limitations if not setup
    await prisma.debtItem.deleteMany({ where: { debt: { id: req.params.id, userId: req.user.userId } }});
    await prisma.debtSplit.deleteMany({ where: { debt: { id: req.params.id, userId: req.user.userId } }});
    await prisma.debt.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir dívida.');
  }
});
