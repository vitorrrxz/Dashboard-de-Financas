import express from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';
import { sendInternalError, validateBody } from '../lib/http.js';
import { salarySchema } from '../lib/schemas.js';

// FIN-121 — dados do perfil que não são da autenticação. Moravam em /api/auth, que agora é todo do
// Better Auth (cadastro, login, sessão, 2FA — ver server/lib/betterAuth.js).
export const router = express.Router();

// Salário informado manualmente (em centavos; no quinzenal, um valor por pagamento) e periodicidade.
const SALARY_SELECT = { salaryCents: true, salarySecondCents: true, salaryFrequency: true, salaryPayDay: true, bonusCents: true, bonusHalf: true, bonusMonth: true };

router.get('/salary', requireAuth, async (req, res) => {
  try {
    const salary = await prisma.user.findUnique({ where: { id: req.user.userId }, select: SALARY_SELECT });
    if (!salary) return res.status(404).json({ error: 'Usuário não encontrado.' });
    res.json(salary);
  } catch (error) {
    sendInternalError(res, error, 'Erro ao carregar o salário.');
  }
});

router.put('/salary', requireAuth, async (req, res) => {
  const validation = validateBody(salarySchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const salary = await prisma.user.update({ where: { id: req.user.userId }, data: validation.data, select: SALARY_SELECT });
    res.json(salary);
  } catch (error) {
    sendInternalError(res, error, 'Erro ao salvar o salário.');
  }
});
