import express from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { authenticateToken } from '../lib/auth.js';
import { sendInternalError, validateBody } from '../lib/http.js';
import { transactionSchema, transactionBatchSchema, transactionUpdateSchema } from '../lib/schemas.js';
import { accountCurrencies, currencyForAccount, hasForeignAccount, ACCOUNT_NOT_FOUND } from '../lib/accountAccess.js';
import { ruleCategory } from '../lib/categorization.js';

export const router = express.Router();

// Chave determinística de deduplicação para importação manual (CSV/OFX) — ver FIN-003.
// Quando o extrato traz um `externalId` (FITID do OFX — identificador estável atribuído
// pelo próprio banco), ele é usado como chave: é a identidade real da transação, evitando
// falso positivo quando duas transações distintas têm mesmo nome/data/valor (ex. duas
// compras idênticas no mesmo dia). CSV não tem equivalente padronizado, então cai no
// heurístico conta+data+valor+nome (não `id` do parser, que é aleatório a cada parse).
function computeImportHash(userId, tx) {
  const key = tx.externalId
    ? [userId, tx.accountId || '', 'ext', tx.externalId]
    : [
        userId,
        tx.accountId || '',
        tx.date || '',
        Number(tx.amount).toFixed(2),
        String(tx.name || '').trim().toLowerCase(),
      ];
  return crypto.createHash('sha256').update(key.join('|')).digest('hex');
}

// --- TRANSACTIONS ---
// Paginação real via `?page=`/`?pageSize=` (ver FIN-023) — opcional e aditiva: sem esses
// parâmetros, mantém o comportamento original (array simples, limitado a 2000) para não
// quebrar os callers existentes (carga inicial do dashboard, que soma todas as transações
// para `stats`, e o reload após import/sync). Com os parâmetros, retorna um objeto
// `{ transactions, total, page, pageSize }`, usado pelo frontend para "carregar mais"
// além do limite de 2000.
router.get('/', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    if (req.query.page === undefined && req.query.pageSize === undefined) {
      const txs = await prisma.transaction.findMany({
        where: { userId },
        orderBy: { date: 'desc' },
        take: 2000
      });
      return res.json(txs);
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(2000, Math.max(1, parseInt(req.query.pageSize, 10) || 200));
    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId },
        orderBy: { date: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.transaction.count({ where: { userId } }),
    ]);
    res.json({ transactions, total, page, pageSize });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar transações.');
  }
});

router.post('/', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  // Supports batch insert
  if (Array.isArray(req.body.transactions)) {
    const validation = validateBody(transactionBatchSchema, req.body);
    if (!validation.ok) return res.status(400).json({ error: validation.message });
    try {
      // Deduplicação aplicada linha a linha via `create` + constraint única
      // `@@unique([userId, importHash])` (ver FIN-021/schema.prisma), não mais um
      // pré-filtro em memória (findMany + Set) seguido de `createMany`: aquele padrão
      // tinha uma janela de corrida — duas importações do mesmo arquivo disparadas em
      // paralelo (ex. duplo clique) podiam ambas passar pela checagem antes de gravar e
      // duplicar as transações, o mesmo problema já corrigido para o sync Pluggy em
      // FIN-021. Criar linha a linha e capturar o erro de constraint (P2002) é mais
      // lento que um `createMany` em lote, mas é atômico a nível de banco — inclusive
      // para duplicatas dentro do próprio arquivo importado (mesma linha repetida).
      // `acceptedIndices` (posição no array original enviado) permite ao frontend saber
      // exatamente quais transações entraram, sem reimplementar o hash (ver FIN-004).
      const acceptedIndices = [];
      let skipped = 0;
      // FIN-074: cada transação fica na moeda da conta em que é importada. FIN-096: uma linha que
      // aponta para conta que não é do usuário recusa o lote inteiro, antes de gravar qualquer uma.
      const accountIds = validation.data.transactions.map(t => t.accountId);
      const currencies = await accountCurrencies(userId, accountIds);
      if (hasForeignAccount(currencies, accountIds)) return res.status(400).json({ error: ACCOUNT_NOT_FOUND });
      // FIN-105: a regra de categoria do usuário vale sobre o palpite do importador (`autoCategory`).
      const categoryRules = await prisma.categoryRule.findMany({ where: { userId } });
      for (let i = 0; i < validation.data.transactions.length; i++) {
        const { externalId, ...t } = validation.data.transactions[i];
        const data = { ...t, userId, currency: currencyForAccount(currencies, t.accountId), category: ruleCategory(categoryRules, t.name) ?? t.category };
        data.importHash = computeImportHash(userId, { ...t, externalId });
        try {
          await prisma.transaction.create({ data });
          acceptedIndices.push(i);
        } catch (err) {
          if (err.code === 'P2002') { skipped++; continue; }
          throw err;
        }
      }
      res.json({ success: true, count: acceptedIndices.length, skipped, acceptedIndices });
    } catch (err) {
      sendInternalError(res, err, 'Erro ao importar transações.');
    }
  } else {
    const validation = validateBody(transactionSchema, req.body);
    if (!validation.ok) return res.status(400).json({ error: validation.message });
    try {
      const { externalId: _externalId, ...rest } = validation.data;
      const currencies = await accountCurrencies(userId, [rest.accountId]);
      if (hasForeignAccount(currencies, [rest.accountId])) return res.status(400).json({ error: ACCOUNT_NOT_FOUND });
      const data = { ...rest, userId, currency: currencyForAccount(currencies, rest.accountId) };
      const tx = await prisma.transaction.create({ data });
      res.json(tx);
    } catch (err) {
      sendInternalError(res, err, 'Erro ao criar transação.');
    }
  }
});

router.delete('/bulk', authenticateToken, async (req, res) => {
  try {
    await prisma.transaction.deleteMany({ where: { userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir transações.');
  }
});

// Registradas depois de `/bulk` — Express casa rotas na ordem de registro, e `/:id`
// capturaria "bulk" como id se viesse antes (ver FIN-022).
router.put('/:id', authenticateToken, async (req, res) => {
  const validation = validateBody(transactionUpdateSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const { externalId: _externalId, ...data } = validation.data;
    // FIN-074: trocar a conta troca a moeda junto — a transação segue na moeda da conta, e em
    // real quando desvinculada (`accountId` nulo).
    if (data.accountId !== undefined) {
      const currencies = await accountCurrencies(req.user.userId, [data.accountId]);
      if (hasForeignAccount(currencies, [data.accountId])) return res.status(400).json({ error: ACCOUNT_NOT_FOUND });
      data.currency = currencyForAccount(currencies, data.accountId);
    }
    const result = await prisma.transaction.updateMany({
      where: { id: req.params.id, userId: req.user.userId },
      data,
    });
    res.json({ success: true, changes: result.count });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao atualizar transação.');
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await prisma.transaction.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir transação.');
  }
});
