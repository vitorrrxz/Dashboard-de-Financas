import express from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticateToken } from '../lib/auth.js';
import { sendInternalError, validateBody } from '../lib/http.js';
import { accountSchema, accountUpdateSchema } from '../lib/schemas.js';

export const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    const accounts = await prisma.account.findMany({ where: { userId: req.user.userId } });
    res.json(accounts);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar contas.');
  }
});

router.post('/', authenticateToken, async (req, res) => {
  const validation = validateBody(accountSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const data = { ...validation.data, userId: req.user.userId };
    const acc = await prisma.account.create({ data });
    res.json(acc);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao criar conta.');
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  const validation = validateBody(accountUpdateSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const { currency } = validation.data;
    // FIN-074: as transações de uma conta estão sempre na moeda dela, então trocar a moeda da
    // conta (em geral, corrigir um cadastro errado) leva as transações junto — na mesma
    // transação de banco, para nunca ficar metade numa moeda e metade na outra. Os valores não
    // são convertidos: a troca corrige o rótulo, não faz câmbio. A posse da conta é conferida
    // antes, para não mexer em transações do usuário apontadas para a conta de outra pessoa.
    const owned = currency
      ? await prisma.account.findFirst({ where: { id, userId }, select: { id: true } })
      : null;
    const [acc] = await prisma.$transaction([
      prisma.account.updateMany({ where: { id, userId }, data: validation.data }),
      ...(owned ? [prisma.transaction.updateMany({ where: { userId, accountId: id }, data: { currency } })] : []),
    ]);
    res.json({ success: true, changes: acc.count });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao atualizar conta.');
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await prisma.account.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir conta.');
  }
});
