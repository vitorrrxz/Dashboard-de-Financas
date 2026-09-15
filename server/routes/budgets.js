import express from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticateToken } from '../lib/auth.js';
import { sendInternalError, validateBody } from '../lib/http.js';
import { budgetSchema, budgetUpdateSchema } from '../lib/schemas.js';

export const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    const budgets = await prisma.budget.findMany({ where: { userId: req.user.userId } });
    res.json(budgets);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar orçamentos.');
  }
});

router.post('/', authenticateToken, async (req, res) => {
  const validation = validateBody(budgetSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const data = { ...validation.data, userId: req.user.userId };
    const budget = await prisma.budget.create({ data });
    res.json(budget);
  } catch (err) {
    // P2002 = violação da constraint única (userId, category) — ver FIN-042. Mensagem
    // específica em vez de 500 genérico, já que é um erro de uso esperado (o usuário já
    // tem um orçamento para esta categoria e deveria editá-lo em vez de criar outro).
    if (err.code === 'P2002') return res.status(400).json({ error: 'Já existe um orçamento para esta categoria. Edite o orçamento existente.' });
    sendInternalError(res, err, 'Erro ao criar orçamento.');
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  const validation = validateBody(budgetUpdateSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const { id } = req.params;
    const budget = await prisma.budget.updateMany({
      where: { id, userId: req.user.userId },
      data: validation.data,
    });
    res.json({ success: true, changes: budget.count });
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ error: 'Já existe um orçamento para esta categoria.' });
    sendInternalError(res, err, 'Erro ao atualizar orçamento.');
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await prisma.budget.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });

    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir orçamento.');
  }
});
