import express from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticateToken } from '../lib/auth.js';
import { sendInternalError, validateBody } from '../lib/http.js';
import { debtSchema, debtUpdateSchema } from '../lib/schemas.js';
import { accountOwnershipError } from '../lib/accountAccess.js';

export const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    const debts = await prisma.debt.findMany({
      where: { userId: req.user.userId },
      include: { subItems: true }
    });
    res.json(debts);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar dívidas.');
  }
});

router.post('/', authenticateToken, async (req, res) => {
  const validation = validateBody(debtSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const accountError = await accountOwnershipError(req.user.userId, validation.data.accountId);
    if (accountError) return res.status(400).json({ error: accountError });
    const { subItems, ...rest } = validation.data;
    // paidAmount/paidInstallments são opcionais no schema (para não forçar reset a 0 em
    // updates parciais via debtUpdateSchema, que reaproveita o mesmo schema base) — mas
    // no create, se ausentes, uma dívida nova sempre começa em 0.
    const data = { paidAmount: 0, paidInstallments: 0, ...rest, userId: req.user.userId };

    const debt = await prisma.debt.create({
      data: {
        ...data,
        subItems: subItems ? { create: subItems.map(s => ({ name: s.name, amount: s.amount, date: s.date })) } : undefined
      },
      include: { subItems: true }
    });
    res.json(debt);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao criar dívida.');
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  const validation = validateBody(debtUpdateSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const accountError = await accountOwnershipError(req.user.userId, validation.data.accountId);
    if (accountError) return res.status(400).json({ error: accountError });
    const { id } = req.params;
    const { subItems: _subItems, ...data } = validation.data;

    const debt = await prisma.debt.update({
      where: { id, userId: req.user.userId },
      data,
      include: { subItems: true }
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

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    // Delete subitems first via cascading or manual delete due to sqlite limitations if not setup
    await prisma.debtItem.deleteMany({ where: { debt: { id: req.params.id, userId: req.user.userId } }});
    await prisma.debt.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir dívida.');
  }
});
