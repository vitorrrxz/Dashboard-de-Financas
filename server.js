import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { PluggyClient } from 'pluggy-sdk';
import crypto from 'crypto';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

dotenv.config();

const app = express();
app.use(helmet()); // cabeçalhos de segurança HTTP padrão (ver FIN-010)
// CORS restrito à origem conhecida do frontend — evita que qualquer site de terceiros
// consiga ler respostas desta API (ver FIN-009 em docs/BACKLOG_DETAIL.md).
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json());

const PORT = 3001;
const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || 'file:./dev.db',
});
const prisma = new PrismaClient({ adapter });

// JWT_SECRET é obrigatório — sem fallback. Um valor hardcoded no código-fonte
// tornaria trivial forjar tokens válidos para qualquer usuário (ver FIN-006 no TODO.md).
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error(
    '\n❌ JWT_SECRET ausente ou fraco (mínimo 32 caracteres).\n' +
    '   Defina JWT_SECRET no arquivo .env antes de iniciar o servidor.\n' +
    '   Para gerar uma chave segura, rode:\n' +
    '   node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n'
  );
  process.exit(1);
}

// Pluggy Client — inicializado com as credenciais do .env
const pluggyClient = new PluggyClient({
  clientId: process.env.PLUGGY_CLIENT_ID || '',
  clientSecret: process.env.PLUGGY_CLIENT_SECRET || '',
});

// Mapeia o `type`/`subtype` retornado pela Pluggy para o enum AccountType do frontend
// (checking | savings | credit | investment | cash). A Pluggy só retorna `type` como
// "BANK" ou "CREDIT" (ver node_modules/pluggy-sdk/dist/types/account.d.ts) — a distinção
// entre conta corrente e poupança vem do `subtype` ("CHECKING_ACCOUNT"/"SAVINGS_ACCOUNT").
// Sem esse mapeamento, `pluggyAcc.type.toLowerCase()` gerava "bank", que não é nenhum
// AccountType válido e quebrava ícone/rótulo no frontend (ver FIN-002 em docs/BACKLOG_DETAIL.md).
function mapPluggyAccountType(pluggyAcc) {
  if (pluggyAcc.type === 'CREDIT') return 'credit';
  if (pluggyAcc.type === 'BANK') {
    return pluggyAcc.subtype === 'SAVINGS_ACCOUNT' ? 'savings' : 'checking';
  }
  return 'checking';
}

// Chave determinística de deduplicação para importação manual (CSV/OFX) — ver FIN-003.
// Baseada em conta + data + valor + nome (não em `id`, que é gerado aleatoriamente no
// cliente a cada parse e por isso não serve para detectar reimportação do mesmo extrato).
function computeImportHash(userId, tx) {
  const key = [
    userId,
    tx.accountId || '',
    tx.date || '',
    Number(tx.amount).toFixed(2),
    String(tx.name || '').trim().toLowerCase(),
  ].join('|');
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Converte reais (decimal) para centavos (inteiro) — ver FIN-015. A API da Pluggy retorna
// valores em reais; o schema local agora armazena tudo em centavos. Duplicado de
// `src/utils/money.ts` porque backend (Node puro) e frontend (bundle Vite) não
// compartilham módulos TS neste projeto.
function toCents(reais) {
  return Math.round(reais * 100);
}

// Loga o erro completo no servidor e retorna uma mensagem genérica ao cliente — nunca
// `error.message`/detalhes internos do Prisma/Node, que podem vazar schema, nomes de
// coluna etc. (ver FIN-011 em docs/BACKLOG_DETAIL.md).
function sendInternalError(res, error, publicMessage = 'Erro interno do servidor.') {
  console.error(publicMessage, error);
  res.status(500).json({ error: publicMessage });
}

// Rate limit nas rotas de autenticação — mitiga força bruta e enumeração de credenciais
// (ver FIN-007 em docs/BACKLOG_DETAIL.md). Não afeta as demais rotas da API.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});

/* -------------------------------------------------------------------------- */
/*                        VALIDAÇÃO DE PAYLOAD (FIN-008)                      */
/* -------------------------------------------------------------------------- */
// Antes desta tarefa, as rotas de CRUD (accounts/transactions/debts) gravavam
// `req.body` quase sem checagem, permitindo dados financeiros inconsistentes
// (ex.: `totalInstallments: 0`, causando divisão por zero no frontend). Cada rota
// agora valida o payload com um schema Zod antes de tocar o banco.

function validateBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues.map(i => i.message).join(' ') || 'Dados inválidos.';
    return { ok: false, message };
  }
  return { ok: true, data: result.data };
}

// Campos monetários trafegam em CENTAVOS (inteiro) entre API e frontend — ver FIN-015
// em docs/BACKLOG_DETAIL.md. `interestRate` é a única exceção: é uma taxa percentual
// (% ao mês), não um valor monetário, e permanece decimal.
const ACCOUNT_TYPES = ['checking', 'savings', 'credit', 'investment', 'cash'];
const accountSchema = z.object({
  name: z.string({ error: 'Nome da conta é obrigatório.' }).trim().min(1, 'Nome da conta é obrigatório.'),
  bank: z.string({ error: 'Banco/operadora é obrigatório.' }).trim().min(1, 'Banco/operadora é obrigatório.'),
  type: z.enum(ACCOUNT_TYPES, { message: `Tipo de conta deve ser um de: ${ACCOUNT_TYPES.join(', ')}.` }),
  balance: z.coerce.number().int('Saldo deve ser um valor inteiro em centavos.'),
  limit: z.coerce.number().int('Limite deve ser um valor inteiro em centavos.').nullable().optional(),
  dueDay: z.coerce.number().int().min(1).max(31).nullable().optional(),
  closingDay: z.coerce.number().int().min(1).max(31).nullable().optional(),
  pendingBill: z.coerce.number().int('Fatura deve ser um valor inteiro em centavos.').nullable().optional(),
  color: z.string({ error: 'Cor é obrigatória.' }).trim().min(1, 'Cor é obrigatória.'),
});
const accountUpdateSchema = accountSchema.partial();

const PAYMENT_TYPES = ['debit', 'credit', 'pix', 'pix_installment'];
const transactionSchema = z.object({
  name: z.string({ error: 'Nome da transação é obrigatório.' }).trim().min(1, 'Nome da transação é obrigatório.'),
  category: z.string({ error: 'Categoria é obrigatória.' }).trim().min(1, 'Categoria é obrigatória.'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD.'),
  amount: z.coerce.number().int('Valor deve ser um inteiro em centavos.'),
  accountId: z.string().trim().min(1).nullable().optional(),
  paymentType: z.enum(PAYMENT_TYPES).optional(),
});
const transactionBatchSchema = z.object({
  transactions: z.array(transactionSchema).min(1, 'Nenhuma transação enviada.'),
});

const DEBT_CATEGORIES = ['Empréstimo', 'Financiamento', 'Cartão de Crédito', 'Pessoal', 'Outros'];
const debtItemSchema = z.object({
  name: z.string().trim().min(1),
  amount: z.coerce.number().int(),
  date: z.string().trim().min(1),
});
const debtSchema = z.object({
  name: z.string({ error: 'Nome da dívida é obrigatório.' }).trim().min(1, 'Nome da dívida é obrigatório.'),
  description: z.string().trim().nullable().optional(),
  category: z.enum(DEBT_CATEGORIES, { message: `Categoria deve ser uma de: ${DEBT_CATEGORIES.join(', ')}.` }),
  totalAmount: z.coerce.number().int('Valor total deve ser um inteiro em centavos.').min(0, 'Valor total não pode ser negativo.'),
  paidAmount: z.coerce.number().int('Valor pago deve ser um inteiro em centavos.').min(0, 'Valor pago não pode ser negativo.').optional(),
  monthlyPayment: z.coerce.number().int('Parcela mensal deve ser um inteiro em centavos.').min(0, 'Parcela mensal não pode ser negativa.'),
  totalInstallments: z.coerce.number().int().min(1, 'Deve haver ao menos 1 parcela.'),
  paidInstallments: z.coerce.number().int().min(0, 'Parcelas pagas não pode ser negativo.').optional(),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de vencimento deve estar no formato YYYY-MM-DD.'),
  interestRate: z.coerce.number().finite().nullable().optional(), // % ao mês, não é dinheiro
  accountId: z.string().trim().min(1).nullable().optional(),
  subItems: z.array(debtItemSchema).optional(),
});
const debtUpdateSchema = debtSchema.partial();

// Middleware de autenticação
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Acesso negado: Token ausente' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Acesso negado: Token inválido' });
    req.user = user;
    next();
  });
};

/* -------------------------------------------------------------------------- */
/*                               AUTH ROUTES                                  */
/* -------------------------------------------------------------------------- */

// Prazo de expiração do token JWT. Reduzido de 7d para 24h (ver FIN-012 em
// docs/BACKLOG_DETAIL.md) — não existe blocklist/refresh token nesta versão; um token
// vazado continua válido até expirar. Mitigação completa (revogação server-side) fica
// registrada como item de roadmap futuro, não implementada agora.
const JWT_EXPIRES_IN = '24h';

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { name, password } = req.body;
  // Normaliza o e-mail (trim + lowercase) antes de checar unicidade e salvar — sem isso,
  // "Usuario@Gmail.com" e "usuario@gmail.com" eram tratados como contas diferentes
  // (ver FIN-013 em docs/BACKLOG_DETAIL.md).
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : req.body.email;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Nome completo é obrigatório.' });
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'E-mail inválido.' });
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'A senha deve conter no mínimo 6 caracteres.' });
  }

  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    // Decisão registrada (ver FIN-014 em docs/BACKLOG_DETAIL.md): mantemos a mensagem
    // específica "Email já cadastrado" — é necessária para o UX de registro e o risco de
    // enumeração é baixo (não vaza dado sensível além de "existe conta"), já mitigado
    // pelo rate limit de FIN-007 acima.
    if (existingUser) return res.status(400).json({ error: 'Email já cadastrado.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, passwordHash },
    });

    const token = jwt.sign({ userId: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    sendInternalError(res, error, 'Erro ao criar usuário.');
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { password } = req.body;
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : req.body.email;

  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'E-mail é obrigatório.' });
  }
  if (!password || typeof password !== 'string' || !password.trim()) {
    return res.status(400).json({ error: 'Senha é obrigatória.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(400).json({ error: 'Credenciais inválidas' });

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) return res.status(400).json({ error: 'Credenciais inválidas' });

    const token = jwt.sign({ userId: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    sendInternalError(res, error, 'Erro ao realizar login.');
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  res.json({ user: req.user });
});

/* -------------------------------------------------------------------------- */
/*                           DATA CRUD ROUTES                                 */
/* -------------------------------------------------------------------------- */

// --- ACCOUNTS ---
app.get('/api/accounts', authenticateToken, async (req, res) => {
  try {
    const accounts = await prisma.account.findMany({ where: { userId: req.user.userId } });
    res.json(accounts);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar contas.');
  }
});

app.post('/api/accounts', authenticateToken, async (req, res) => {
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

app.put('/api/accounts/:id', authenticateToken, async (req, res) => {
  const validation = validateBody(accountUpdateSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const { id } = req.params;
    const acc = await prisma.account.updateMany({
      where: { id, userId: req.user.userId },
      data: validation.data,
    });
    res.json({ success: true, changes: acc.count });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao atualizar conta.');
  }
});

app.delete('/api/accounts/:id', authenticateToken, async (req, res) => {
  try {
    await prisma.account.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir conta.');
  }
});

// --- TRANSACTIONS ---
app.get('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const txs = await prisma.transaction.findMany({
      where: { userId: req.user.userId },
      orderBy: { date: 'desc' },
      take: 2000
    });
    res.json(txs);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar transações.');
  }
});

app.post('/api/transactions', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  // Supports batch insert
  if (Array.isArray(req.body.transactions)) {
    const validation = validateBody(transactionBatchSchema, req.body);
    if (!validation.ok) return res.status(400).json({ error: validation.message });
    try {
      const mapped = validation.data.transactions.map(t => {
        const data = { ...t, userId };
        data.importHash = computeImportHash(userId, data);
        return data;
      });

      // Filtra transações cuja chave de deduplicação já existe para este usuário —
      // evita duplicar dados ao reimportar o mesmo extrato (ver FIN-003).
      const hashes = mapped.map(t => t.importHash);
      const existing = await prisma.transaction.findMany({
        where: { userId, importHash: { in: hashes } },
        select: { importHash: true },
      });
      // Também descarta duplicatas dentro do próprio arquivo importado (ex.: mesma
      // linha repetida no CSV), não só as que já existem no banco.
      const seenHashes = new Set(existing.map(e => e.importHash));
      const newTxs = [];
      for (const t of mapped) {
        if (seenHashes.has(t.importHash)) continue;
        seenHashes.add(t.importHash);
        newTxs.push(t);
      }
      const skipped = mapped.length - newTxs.length;

      if (newTxs.length > 0) {
        await prisma.transaction.createMany({ data: newTxs });
      }
      res.json({ success: true, count: newTxs.length, skipped });
    } catch (err) {
      sendInternalError(res, err, 'Erro ao importar transações.');
    }
  } else {
    const validation = validateBody(transactionSchema, req.body);
    if (!validation.ok) return res.status(400).json({ error: validation.message });
    try {
      const data = { ...validation.data, userId };
      const tx = await prisma.transaction.create({ data });
      res.json(tx);
    } catch (err) {
      sendInternalError(res, err, 'Erro ao criar transação.');
    }
  }
});

app.delete('/api/transactions/bulk', authenticateToken, async (req, res) => {
  try {
    await prisma.transaction.deleteMany({ where: { userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir transações.');
  }
});

// --- DEBTS ---
app.get('/api/debts', authenticateToken, async (req, res) => {
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

app.post('/api/debts', authenticateToken, async (req, res) => {
  const validation = validateBody(debtSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
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

app.put('/api/debts/:id', authenticateToken, async (req, res) => {
  const validation = validateBody(debtUpdateSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const { id } = req.params;
    const { subItems: _subItems, ...data } = validation.data;
    if (data.accountId === '') data.accountId = null;

    const debt = await prisma.debt.update({
      where: { id, userId: req.user.userId },
      data,
      include: { subItems: true }
    });
    res.json(debt);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao atualizar dívida.');
  }
});

app.delete('/api/debts/:id', authenticateToken, async (req, res) => {
  try {
    // Delete subitems first via cascading or manual delete due to sqlite limitations if not setup
    await prisma.debtItem.deleteMany({ where: { debt: { id: req.params.id, userId: req.user.userId } }});
    await prisma.debt.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir dívida.');
  }
});

/* -------------------------------------------------------------------------- */
/*                           PLUGGY OPEN FINANCE                               */
/* -------------------------------------------------------------------------- */

// POST /api/pluggy/connect-token — Gera o token temporário para o widget
app.post('/api/pluggy/connect-token', authenticateToken, async (req, res) => {
  try {
    const response = await pluggyClient.createConnectToken(undefined, {
      clientUserId: req.user.userId,
    });
    res.json({ accessToken: response.accessToken });
  } catch (error) {
    sendInternalError(res, error, 'Erro ao conectar à API da Pluggy.');
  }
});

// POST /api/pluggy/connect-item — Recebe itemId do widget e registra no banco
app.post('/api/pluggy/connect-item', authenticateToken, async (req, res) => {
  const { itemId } = req.body;
  if (!itemId) return res.status(400).json({ error: 'itemId é obrigatório.' });

  try {
    const pluggyItem = await pluggyClient.fetchItem(itemId);
    const userId = req.user.userId;

    // Cria ou atualiza a conta representando o banco conectado
    const existing = await prisma.account.findFirst({
      where: { userId, pluggyId: itemId }
    });

    if (!existing) {
      await prisma.account.create({
        data: {
          userId,
          pluggyId: itemId,
          name: pluggyItem.connector.name,
          bank: pluggyItem.connector.name,
          type: 'checking',
          balance: 0,
          color: '#6366f1',
        }
      });
    }

    res.json({ success: true, providerName: pluggyItem.connector.name });
  } catch (error) {
    sendInternalError(res, error, 'Erro ao registrar conexão bancária.');
  }
});

// POST /api/pluggy/sync/:itemId — Sincroniza contas e transações do banco conectado
app.post('/api/pluggy/sync/:itemId', authenticateToken, async (req, res) => {
  const { itemId } = req.params;
  const userId = req.user.userId;

  try {
    const accountsRes = await pluggyClient.fetchAccounts(itemId);
    if (!accountsRes.results || accountsRes.results.length === 0) {
      return res.status(404).json({ error: 'Nenhuma conta encontrada para este item.' });
    }

    let totalTxs = 0;

    for (const pluggyAcc of accountsRes.results) {
      // Upsert da conta usando pluggyId
      let localAccount = await prisma.account.findFirst({
        where: { userId, pluggyId: pluggyAcc.id }
      });

      if (!localAccount) {
        localAccount = await prisma.account.create({
          data: {
            userId,
            pluggyId: pluggyAcc.id,
            name: pluggyAcc.name,
            bank: pluggyAcc.marketingName || 'Banco Conectado',
            type: mapPluggyAccountType(pluggyAcc),
            balance: toCents(pluggyAcc.balance),
            color: '#6366f1',
          }
        });
      } else {
        await prisma.account.updateMany({
          where: { id: localAccount.id, userId },
          data: { balance: toCents(pluggyAcc.balance), name: pluggyAcc.name }
        });
      }

      // Para cartões de crédito, busca a fatura real via endpoint dedicado da Pluggy
      // e atualiza `pendingBill` — não é possível inferir a fatura a partir de `balance`
      // para contas do tipo CREDIT (ver FIN-001 em docs/BACKLOG_DETAIL.md).
      if (pluggyAcc.type === 'CREDIT') {
        try {
          const billsRes = await pluggyClient.fetchCreditCardBills(pluggyAcc.id);
          const bills = billsRes?.results ?? [];
          if (bills.length > 0) {
            // A fatura pendente é a mais recentemente fechada (maior billClosingDate/dueDate) —
            // não a de menor data, que representaria uma fatura antiga já superada.
            const currentBill = [...bills].sort((a, b) => {
              const dateA = new Date(a.billClosingDate ?? a.dueDate).getTime();
              const dateB = new Date(b.billClosingDate ?? b.dueDate).getTime();
              return dateB - dateA;
            })[0];
            await prisma.account.updateMany({
              where: { id: localAccount.id, userId },
              data: { pendingBill: toCents(currentBill.totalAmount) },
            });
          }
        } catch (billError) {
          console.error(`Erro ao buscar fatura do cartão (accountId=${pluggyAcc.id}):`, billError);
        }
      }

      // Busca transações do último mês
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      const fromDate = oneMonthAgo.toISOString().split('T')[0];

      const txsRes = await pluggyClient.fetchTransactions(pluggyAcc.id, { from: fromDate });

      for (const tx of txsRes.results) {
        const txDate = tx.date.toISOString().split('T')[0];
        const pluggyTxId = tx.id;

        // Upsert usando pluggyId como chave de idempotência
        const existingTx = await prisma.transaction.findFirst({
          where: { userId, pluggyId: pluggyTxId }
        });

        if (!existingTx) {
          await prisma.transaction.create({
            data: {
              userId,
              accountId: localAccount.id,
              pluggyId: pluggyTxId,
              name: tx.description,
              category: tx.category || 'Outros',
              date: txDate,
              amount: toCents(tx.amount),
            }
          });
          totalTxs++;
        } else {
          await prisma.transaction.updateMany({
            where: { id: existingTx.id, userId },
            data: {
              name: tx.description,
              category: tx.category || 'Outros',
              date: txDate,
              amount: toCents(tx.amount),
            }
          });
        }
      }
    }

    res.json({ success: true, message: `Sincronizacao concluida! ${totalTxs} novas transacoes importadas.` });
  } catch (error) {
    sendInternalError(res, error, 'Erro na sincronização de dados.');
  }
});

app.listen(PORT, () => {
  console.log(`Finance Dashboard API Proxy running on http://localhost:${PORT}`);
});
