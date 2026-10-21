import express from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticateToken } from '../lib/auth.js';
import { sendInternalError, validateBody } from '../lib/http.js';
import { categoryRuleRequestSchema } from '../lib/schemas.js';
import { foldText, ruleCategory } from '../lib/categorization.js';

export const router = express.Router();

// --- REGRAS DE CATEGORIA (FIN-105) ---
router.get('/', authenticateToken, async (req, res) => {
  try {
    res.json(await prisma.categoryRule.findMany({ where: { userId: req.user.userId }, orderBy: { match: 'asc' } }));
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar as regras de categoria.');
  }
});

// Criar e editar pela mesma rota: uma regra por texto, e mandar o mesmo texto troca a categoria.
// FIN-106: com `applyToExisting`, recategoriza também as transações já gravadas em que esta regra
// vence — uma regra mais longa, de outra categoria ("uber eats"), continua valendo nas dela.
// `updated` diz quantas mudaram.
router.post('/', authenticateToken, async (req, res) => {
  const validation = validateBody(categoryRuleRequestSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  const userId = req.user.userId;
  const { match, category, applyToExisting } = validation.data;
  try {
    const rule = await prisma.categoryRule.upsert({
      where: { userId_match: { userId, match } },
      create: { userId, match, category },
      update: { category },
    });
    let updated = 0;
    if (applyToExisting) {
      const [rules, txs] = await Promise.all([
        prisma.categoryRule.findMany({ where: { userId } }),
        prisma.transaction.findMany({ where: { userId }, select: { id: true, name: true, category: true } }),
      ]);
      const folded = foldText(match);
      const ids = txs
        .filter(t => t.category !== category && foldText(t.name).includes(folded) && ruleCategory(rules, t.name) === category)
        .map(t => t.id);
      // Em lotes de 500 ids, abaixo do limite de parâmetros do SQLite.
      for (let i = 0; i < ids.length; i += 500) {
        updated += (await prisma.transaction.updateMany({ where: { userId, id: { in: ids.slice(i, i + 500) } }, data: { category } })).count;
      }
    }
    res.json({ ...rule, updated });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao salvar a regra de categoria.');
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await prisma.categoryRule.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir a regra de categoria.');
  }
});
