import express from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { authenticateToken } from '../lib/auth.js';
import { sendInternalError, validateBody } from '../lib/http.js';
import { recurringSchema, recurringUpdateSchema } from '../lib/schemas.js';
import { accountOwnershipError } from '../lib/accountAccess.js';
import { advanceOccurrence, todayISO } from '../lib/dates.js';
import { BASE_CURRENCY } from '../lib/money.js';

export const router = express.Router();

/**
 * Chave determinística de uma ocorrência de recorrência, gravada em `Transaction.importHash`.
 * Reaproveita a constraint única `(userId, importHash)` criada em FIN-003 para tornar o
 * lançamento idempotente **no banco**, não só na aplicação: se o processamento rodar duas
 * vezes em paralelo (ex.: dois carregamentos simultâneos do dashboard, ou o duplo efeito do
 * StrictMode em dev), a segunda tentativa não cria uma transação duplicada.
 */
function recurringOccurrenceHash(userId, recurringId, occurrenceDate) {
  return crypto.createHash('sha256').update(['recurring', userId, recurringId, occurrenceDate].join('|')).digest('hex');
}

// Teto de ocorrências geradas por chamada, por recorrência. Uma recorrência semanal parada
// há anos geraria centenas de transações numa única requisição; o teto distribui isso entre
// chamadas sucessivas (o ponteiro `nextOccurrence` avança a cada uma) e também limita o
// estrago caso `advanceOccurrence` deixe de avançar por um dado inesperado.
const MAX_OCCURRENCES_PER_RUN = 120;

// --- RECURRING TRANSACTIONS (FIN-054) ---
router.get('/', authenticateToken, async (req, res) => {
  try {
    const recurring = await prisma.recurringTransaction.findMany({ where: { userId: req.user.userId } });
    res.json(recurring);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar recorrências.');
  }
});

router.post('/', authenticateToken, async (req, res) => {
  const validation = validateBody(recurringSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const accountError = await accountOwnershipError(req.user.userId, validation.data.accountId);
    if (accountError) return res.status(400).json({ error: accountError });
    const data = { active: true, ...validation.data, userId: req.user.userId };
    const recurring = await prisma.recurringTransaction.create({ data });
    res.json(recurring);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao criar recorrência.');
  }
});

/*
 * Lança as ocorrências já vencidas de todas as recorrências ativas do usuário, criando as
 * `Transaction` reais e avançando `nextOccurrence`. Declarado ANTES das rotas com `:id`
 * para que "process" nunca seja capturado como um id.
 *
 * Idempotente por construção: cada ocorrência tem um `importHash` determinístico
 * (`recurringOccurrenceHash`) protegido pela constraint única `(userId, importHash)`, e a
 * criação das transações + o avanço do ponteiro acontecem na mesma transação de banco —
 * então nunca fica uma transação lançada sem o ponteiro correspondente ter avançado, nem o
 * contrário.
 */
router.post('/process', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const today = todayISO();
    // Comparação de data em string ISO (YYYY-MM-DD) é lexicográfica = cronológica, mesma
    // convenção usada em `isDebtOverdue` no frontend.
    const dueRecurrences = await prisma.recurringTransaction.findMany({
      where: { userId, active: true, nextOccurrence: { lte: today } },
      // FIN-074: a ocorrência nasce na moeda da conta da recorrência (real, sem conta).
      include: { account: { select: { currency: true } } },
    });

    let processed = 0;
    for (const rec of dueRecurrences) {
      const ops = [];
      let occurrence = rec.nextOccurrence;

      while (occurrence <= today && ops.length < MAX_OCCURRENCES_PER_RUN) {
        const importHash = recurringOccurrenceHash(userId, rec.id, occurrence);
        ops.push(prisma.transaction.upsert({
          where: { userId_importHash: { userId, importHash } },
          create: {
            userId,
            accountId: rec.accountId,
            name: rec.name,
            category: rec.category,
            date: occurrence,
            amount: rec.amount,
            currency: rec.account?.currency ?? BASE_CURRENCY,
            importHash,
          },
          // Ocorrência já lançada por uma execução anterior/concorrente: nada a fazer.
          update: {},
        }));

        const next = advanceOccurrence(occurrence, rec.frequency);
        // Proteção contra dado inesperado (frequência desconhecida, data malformada): sem
        // avanço, o laço giraria para sempre sobre a mesma ocorrência.
        if (next <= occurrence) break;
        occurrence = next;
      }

      if (ops.length === 0) continue;
      ops.push(prisma.recurringTransaction.update({
        where: { id: rec.id },
        data: { nextOccurrence: occurrence },
      }));
      await prisma.$transaction(ops);
      processed += ops.length - 1; // desconta o update do ponteiro
    }

    // `processed` conta ocorrências processadas nesta execução. Numa reexecução rara sobre
    // as mesmas ocorrências (upsert no-op), o número reflete o que foi reprocessado, não
    // transações novas — o frontend usa apenas "> 0" para decidir se recarrega a lista.
    res.json({ success: true, processed });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao processar recorrências.');
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  const validation = validateBody(recurringUpdateSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const accountError = await accountOwnershipError(req.user.userId, validation.data.accountId);
    if (accountError) return res.status(400).json({ error: accountError });
    const recurring = await prisma.recurringTransaction.updateMany({
      where: { id: req.params.id, userId: req.user.userId },
      data: validation.data,
    });
    res.json({ success: true, changes: recurring.count });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao atualizar recorrência.');
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await prisma.recurringTransaction.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir recorrência.');
  }
});
