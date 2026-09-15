import express from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticateToken } from '../lib/auth.js';
import { sendInternalError, validateBody } from '../lib/http.js';
import { investmentSchema, investmentUpdateSchema } from '../lib/schemas.js';
import { nonCreditAccountError } from '../lib/accountAccess.js';

export const router = express.Router();

// --- INVESTMENTS (FIN-071) ---
// Cartão não guarda aplicação: o saldo dele é uma fatura, não dinheiro aplicado.
async function investmentAccountError(userId, accountId) {
  return nonCreditAccountError(userId, accountId, 'Um investimento não pode ser vinculado a um cartão de crédito.');
}

router.get('/', authenticateToken, async (req, res) => {
  try {
    const investments = await prisma.investment.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'asc' },
    });
    res.json(investments);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar investimentos.');
  }
});

router.post('/', authenticateToken, async (req, res) => {
  const validation = validateBody(investmentSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  const userId = req.user.userId;
  try {
    const accountError = await investmentAccountError(userId, validation.data.accountId);
    if (accountError) return res.status(400).json({ error: accountError });
    const investment = await prisma.investment.create({ data: { ...validation.data, userId } });
    res.json(investment);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao criar investimento.');
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  const validation = validateBody(investmentUpdateSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  const userId = req.user.userId;
  try {
    const accountError = await investmentAccountError(userId, validation.data.accountId);
    if (accountError) return res.status(400).json({ error: accountError });
    // `update`, e não `updateMany`, para devolver o registro com o `updatedAt` novo — a
    // carteira mostra há quanto tempo cada valor foi atualizado. O `userId` no `where`
    // garante o isolamento: id inexistente ou de outro usuário cai no P2025 (404), como em
    // /api/debts/:id.
    const investment = await prisma.investment.update({
      where: { id: req.params.id, userId },
      data: validation.data,
    });
    res.json(investment);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Investimento não encontrado.' });
    sendInternalError(res, err, 'Erro ao atualizar investimento.');
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await prisma.investment.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir investimento.');
  }
});
