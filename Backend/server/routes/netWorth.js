import express from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticateToken } from '../lib/auth.js';
import { sendInternalError, validateBody } from '../lib/http.js';
import { netWorthSnapshotSchema } from '../lib/schemas.js';
import { todayISO } from '../lib/dates.js';

export const router = express.Router();

// --- PATRIMÔNIO LÍQUIDO — HISTÓRICO MENSAL (FIN-112) ---
// Um retrato por mês. Esta rota sempre grava no mês corrente do relógio do SERVIDOR — nunca um mês
// que o cliente informe —, então os meses anteriores nunca são reescritos por ela; é assim, e não
// com uma checagem extra, que "só o mês corrente muda" fica garantido.
router.post('/snapshot', authenticateToken, async (req, res) => {
  const validation = validateBody(netWorthSnapshotSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  const userId = req.user.userId;
  const month = todayISO().slice(0, 7);
  try {
    const snapshot = await prisma.netWorthSnapshot.upsert({
      where: { userId_month: { userId, month } },
      create: { userId, month, ...validation.data },
      update: validation.data,
    });
    res.json(snapshot);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao salvar o retrato do patrimônio.');
  }
});

router.get('/history', authenticateToken, async (req, res) => {
  try {
    const history = await prisma.netWorthSnapshot.findMany({
      where: { userId: req.user.userId },
      orderBy: { month: 'asc' },
    });
    res.json(history);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar o histórico do patrimônio.');
  }
});
