import express from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticateToken } from '../lib/auth.js';
import { sendInternalError, validateBody } from '../lib/http.js';
import { goalSchema, goalUpdateSchema } from '../lib/schemas.js';
import { nonCreditAccountError } from '../lib/accountAccess.js';

export const router = express.Router();

// --- GOALS (FIN-050) ---
// FIN-113 — vínculo (opcional, nunca os dois) com conta ou investimento: mesma regra de posse de
// FIN-096, feita aqui e não no schema (ver comentário de `goalSchema`).
async function goalAccountError(userId, accountId) {
  return nonCreditAccountError(userId, accountId, 'Uma meta não pode ser vinculada a um cartão de crédito.');
}
async function goalInvestmentError(userId, investmentId) {
  if (!investmentId) return null;
  const investment = await prisma.investment.findFirst({ where: { id: investmentId, userId }, select: { id: true } });
  return investment ? null : 'Investimento não encontrado.';
}
/** Erro de posse do vínculo enviado, ou de ter os dois ao mesmo tempo — checados nas duas rotas de escrita. */
async function goalLinkError(userId, accountId, investmentId) {
  if (accountId && investmentId) return 'Uma meta só pode ser vinculada a uma conta OU a um investimento, não os dois.';
  return (await goalAccountError(userId, accountId)) ?? (await goalInvestmentError(userId, investmentId));
}

router.get('/', authenticateToken, async (req, res) => {
  try {
    const goals = await prisma.goal.findMany({ where: { userId: req.user.userId } });
    res.json(goals);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar metas.');
  }
});

router.post('/', authenticateToken, async (req, res) => {
  const validation = validateBody(goalSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  const userId = req.user.userId;
  try {
    const linkError = await goalLinkError(userId, validation.data.accountId, validation.data.investmentId);
    if (linkError) return res.status(400).json({ error: linkError });
    // `currentAmount` é opcional no schema (para servir ao update parcial); no create, uma
    // meta nova sempre começa em 0 quando não informado (a menos que já nasça ligada — o
    // cliente manda o saldo/valor atual já calculado, ver FIN-112 para o mesmo padrão).
    const data = { currentAmount: 0, ...validation.data, userId };
    const goal = await prisma.goal.create({ data });
    res.json(goal);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao criar meta.');
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  const validation = validateBody(goalUpdateSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  const userId = req.user.userId;
  try {
    const linkError = await goalLinkError(userId, validation.data.accountId, validation.data.investmentId);
    if (linkError) return res.status(400).json({ error: linkError });
    // Ligar a um dos dois desliga o outro — sem isto, um PUT que só manda `accountId` deixaria
    // um `investmentId` antigo (de uma edição anterior) esquecido no banco, com os dois vínculos
    // ativos ao mesmo tempo.
    const data = { ...validation.data };
    if (data.accountId) data.investmentId = null;
    else if (data.investmentId) data.accountId = null;
    const goal = await prisma.goal.updateMany({ where: { id: req.params.id, userId }, data });
    res.json({ success: true, changes: goal.count });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao atualizar meta.');
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await prisma.goal.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir meta.');
  }
});
