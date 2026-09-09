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
import { fileURLToPath } from 'url';

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

// Pluggy Client — inicialização preguiçosa (lazy). O construtor do SDK lança exceção
// síncrona ("Missing authorization for API communication") quando clientId/clientSecret
// estão vazios — como essas credenciais são opcionais (só necessárias para conectar
// bancos reais, ver .env.example), instanciar no topo do módulo derrubava o servidor
// inteiro no boot para quem não configurou Pluggy. Agora só é criado (e só falha) quando
// uma rota Pluggy é de fato chamada.
let pluggyClient = null;
function getPluggyClient() {
  if (pluggyClient) return pluggyClient;
  if (!process.env.PLUGGY_CLIENT_ID || !process.env.PLUGGY_CLIENT_SECRET) {
    throw new Error('Integração com Pluggy não configurada (PLUGGY_CLIENT_ID/PLUGGY_CLIENT_SECRET ausentes no .env).');
  }
  pluggyClient = new PluggyClient({
    clientId: process.env.PLUGGY_CLIENT_ID,
    clientSecret: process.env.PLUGGY_CLIENT_SECRET,
  });
  return pluggyClient;
}

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

// Traduz o `status` de um item Pluggy (ver node_modules/pluggy-sdk/dist/types/item.d.ts)
// numa mensagem acionável quando indica que a conexão precisa de reautenticação — ver
// FIN-041 em docs/BACKLOG_DETAIL.md. `null` significa "nada a avisar, prossiga
// normalmente" (inclui UPDATED, UPDATING, MERGING e os estados de MFA em andamento, que
// não são erros).
function pluggyReauthMessage(status) {
  if (status === 'LOGIN_ERROR') {
    return 'A conexão com este banco expirou ou as credenciais mudaram. Reconecte o banco para continuar sincronizando.';
  }
  if (status === 'OUTDATED') {
    return 'A última tentativa de sincronização deste banco falhou. Tente novamente; se o problema persistir, reconecte o banco.';
  }
  return null;
}

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
// Limite configurável via env var só para não estourar em testes de integração (FIN-031 a
// FIN-033), que fazem dezenas de register/login em sequência contra o mesmo app — em
// produção, sem AUTH_RATE_LIMIT definida, o limite continua 10 (mesmo valor de antes).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: Number(process.env.AUTH_RATE_LIMIT) || 10,
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

// Aceita `accountId: ''` (usado pelo frontend para "sem conta vinculada") como sinônimo
// de `null` — sem isso, `z.string().min(1)` rejeitava string vazia com um erro de
// validação antes mesmo do handler rodar, tornando inalcançável a normalização que a
// rota PUT /api/debts/:id fazia depois (ver correção abaixo).
const accountIdField = z.preprocess(
  v => (v === '' ? null : v),
  z.string().trim().min(1).nullable().optional()
);

const PAYMENT_TYPES = ['debit', 'credit', 'pix', 'pix_installment'];
const transactionSchema = z.object({
  name: z.string({ error: 'Nome da transação é obrigatório.' }).trim().min(1, 'Nome da transação é obrigatório.'),
  category: z.string({ error: 'Categoria é obrigatória.' }).trim().min(1, 'Categoria é obrigatória.'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD.'),
  amount: z.coerce.number().int('Valor deve ser um inteiro em centavos.'),
  accountId: accountIdField,
  paymentType: z.enum(PAYMENT_TYPES).optional(),
  externalId: z.string().trim().min(1).optional(), // FITID do OFX — ver computeImportHash
});
const transactionBatchSchema = z.object({
  transactions: z.array(transactionSchema).min(1, 'Nenhuma transação enviada.'),
});
const transactionUpdateSchema = transactionSchema.partial();

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
  accountId: accountIdField,
  subItems: z.array(debtItemSchema).optional(),
});
const debtUpdateSchema = debtSchema.partial();

// FIN-042/FIN-043 — orçamento mensal por categoria (Fase 3). `category` é texto livre
// (não um enum fechado, ao contrário de `debtSchema.category`) porque precisa casar com a
// categoria de qualquer transação — inclusive categorias digitadas manualmente pelo
// usuário na importação, que não pertencem a uma lista fixa (ver `CATEGORY_COLORS` em
// App.tsx e `CATEGORY_RULES` em parsers.ts). `monthlyLimit` exige > 0: um orçamento de
// R$0 não tem sentido de negócio e, sem essa validação, `computeBudgetProgress`
// (src/utils/budget.ts) precisaria tratar divisão por zero.
const budgetSchema = z.object({
  category: z.string({ error: 'Categoria é obrigatória.' }).trim().min(1, 'Categoria é obrigatória.'),
  monthlyLimit: z.coerce.number().int('Limite mensal deve ser um inteiro em centavos.').min(1, 'Limite mensal deve ser maior que zero.'),
});
const budgetUpdateSchema = budgetSchema.partial();

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
// Paginação real via `?page=`/`?pageSize=` (ver FIN-023) — opcional e aditiva: sem esses
// parâmetros, mantém o comportamento original (array simples, limitado a 2000) para não
// quebrar os callers existentes (carga inicial do dashboard, que soma todas as transações
// para `stats`, e o reload após import/sync). Com os parâmetros, retorna um objeto
// `{ transactions, total, page, pageSize }`, usado pelo frontend para "carregar mais"
// além do limite de 2000.
app.get('/api/transactions', authenticateToken, async (req, res) => {
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

app.post('/api/transactions', authenticateToken, async (req, res) => {
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
      for (let i = 0; i < validation.data.transactions.length; i++) {
        const { externalId, ...t } = validation.data.transactions[i];
        const data = { ...t, userId };
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
      const data = { ...rest, userId };
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

// Registradas depois de `/bulk` — Express casa rotas na ordem de registro, e `/:id`
// capturaria "bulk" como id se viesse antes (ver FIN-022).
app.put('/api/transactions/:id', authenticateToken, async (req, res) => {
  const validation = validateBody(transactionUpdateSchema, req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message });
  try {
    const { externalId: _externalId, ...data } = validation.data;
    const result = await prisma.transaction.updateMany({
      where: { id: req.params.id, userId: req.user.userId },
      data,
    });
    res.json({ success: true, changes: result.count });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao atualizar transação.');
  }
});

app.delete('/api/transactions/:id', authenticateToken, async (req, res) => {
  try {
    await prisma.transaction.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir transação.');
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

    const debt = await prisma.debt.update({
      where: { id, userId: req.user.userId },
      data,
      include: { subItems: true }
    });
    res.json(debt);
  } catch (err) {
    // P2025 = nenhum registro encontrado com esse `where` (id + userId) — ou a dívida não
    // existe, ou pertence a outro usuário. Mesmo comportamento de "não encontrado" que
    // accounts/transactions dão via updateMany (changes:0), só que aqui `update` lança em
    // vez de simplesmente não afetar linhas — sem este catch, cairia em 500 (ver FIN-032).
    if (err.code === 'P2025') return res.status(404).json({ error: 'Dívida não encontrada.' });
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

// --- BUDGETS (FIN-043) ---
app.get('/api/budgets', authenticateToken, async (req, res) => {
  try {
    const budgets = await prisma.budget.findMany({ where: { userId: req.user.userId } });
    res.json(budgets);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao buscar orçamentos.');
  }
});

app.post('/api/budgets', authenticateToken, async (req, res) => {
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

app.put('/api/budgets/:id', authenticateToken, async (req, res) => {
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

app.delete('/api/budgets/:id', authenticateToken, async (req, res) => {
  try {
    await prisma.budget.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao excluir orçamento.');
  }
});

/* -------------------------------------------------------------------------- */
/*                           PLUGGY OPEN FINANCE                               */
/* -------------------------------------------------------------------------- */

// POST /api/pluggy/connect-token — Gera o token temporário para o widget
app.post('/api/pluggy/connect-token', authenticateToken, async (req, res) => {
  try {
    const response = await getPluggyClient().createConnectToken(undefined, {
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
    const pluggyItem = await getPluggyClient().fetchItem(itemId);
    const userId = req.user.userId;

    // Upsert usando a constraint (userId, pluggyId) — atômico a nível de banco, evita
    // duplicar a conta se duas requisições chegarem em paralelo (ver FIN-021).
    await prisma.account.upsert({
      where: { userId_pluggyId: { userId, pluggyId: itemId } },
      update: {}, // já existe — nada a atualizar aqui, o sync cuida dos dados reais da conta
      create: {
        userId,
        pluggyId: itemId,
        name: pluggyItem.connector.name,
        bank: pluggyItem.connector.name,
        type: 'checking',
        balance: 0,
        color: '#6366f1',
      },
    });

    // Reporta o status do item já na conexão inicial (ver FIN-041) — um item pode nascer
    // em LOGIN_ERROR (ex. credenciais rejeitadas pelo banco na primeira tentativa).
    res.json({
      success: true,
      providerName: pluggyItem.connector.name,
      pluggyStatus: pluggyItem.status,
      statusMessage: pluggyReauthMessage(pluggyItem.status),
    });
  } catch (error) {
    sendInternalError(res, error, 'Erro ao registrar conexão bancária.');
  }
});

// POST /api/pluggy/sync/:itemId — Sincroniza contas e transações do banco conectado
app.post('/api/pluggy/sync/:itemId', authenticateToken, async (req, res) => {
  const { itemId } = req.params;
  const userId = req.user.userId;

  try {
    // Verifica o status do item antes de tentar sincronizar (ver FIN-041 em
    // docs/BACKLOG_DETAIL.md) — sem isso, uma conexão que exige reautenticação
    // (LOGIN_ERROR/OUTDATED) falhava na sincronização com um erro genérico, sem indicar
    // ao usuário que a ação necessária é reconectar o banco.
    const pluggyItem = await getPluggyClient().fetchItem(itemId);
    const reauthMessage = pluggyReauthMessage(pluggyItem.status);
    if (reauthMessage) {
      return res.status(409).json({ error: reauthMessage, pluggyStatus: pluggyItem.status });
    }

    const accountsRes = await getPluggyClient().fetchAccounts(itemId);
    if (!accountsRes.results || accountsRes.results.length === 0) {
      return res.status(404).json({ error: 'Nenhuma conta encontrada para este item.' });
    }

    let totalTxs = 0;

    for (const pluggyAcc of accountsRes.results) {
      // Upsert atômico via constraint (userId, pluggyId) — ver FIN-021.
      const localAccount = await prisma.account.upsert({
        where: { userId_pluggyId: { userId, pluggyId: pluggyAcc.id } },
        create: {
          userId,
          pluggyId: pluggyAcc.id,
          name: pluggyAcc.name,
          bank: pluggyAcc.marketingName || 'Banco Conectado',
          type: mapPluggyAccountType(pluggyAcc),
          balance: toCents(pluggyAcc.balance),
          color: '#6366f1',
        },
        update: { balance: toCents(pluggyAcc.balance), name: pluggyAcc.name },
      });

      // Para cartões de crédito, busca a fatura real via endpoint dedicado da Pluggy
      // e atualiza `pendingBill` — não é possível inferir a fatura a partir de `balance`
      // para contas do tipo CREDIT (ver FIN-001 em docs/BACKLOG_DETAIL.md).
      if (pluggyAcc.type === 'CREDIT') {
        try {
          const billsRes = await getPluggyClient().fetchCreditCardBills(pluggyAcc.id);
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

      // Busca transações do último mês, paginando até obter todas — a API da Pluggy pagina
      // por padrão (20 itens/página, máx. 500), então sem este loop uma conta com mais
      // transações que uma página perderia dados silenciosamente (ver FIN-038 em
      // docs/BACKLOG_DETAIL.md).
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      const fromDate = oneMonthAgo.toISOString().split('T')[0];

      const allPluggyTxs = [];
      let page = 1;
      let totalPages = 1;
      do {
        const txsRes = await getPluggyClient().fetchTransactions(pluggyAcc.id, { from: fromDate, page, pageSize: 500 });
        allPluggyTxs.push(...txsRes.results);
        totalPages = txsRes.totalPages;
        page++;
      } while (page <= totalPages);

      // FIN-037: busca de uma vez os `pluggyId` já existentes desta sincronização (1
      // consulta), em vez de um `findFirst` por transação (N consultas).
      const existingTxs = await prisma.transaction.findMany({
        where: { userId, pluggyId: { in: allPluggyTxs.map(t => t.id) } },
        select: { pluggyId: true, name: true, date: true, amount: true },
      });
      const existingByPluggyId = new Map(existingTxs.map(t => [t.pluggyId, t]));

      const newPluggyTxs = allPluggyTxs.filter(tx => !existingByPluggyId.has(tx.id));
      totalTxs += newPluggyTxs.length;

      // Transações já existentes: a Pluggy pode reportar valor/descrição/data diferentes
      // numa sincronização posterior (ex.: transação que estava pendente e "assentou" com
      // valor final diferente do provisório) — sem isto o app ficaria com dados
      // desatualizados indefinidamente após a primeira sincronização. Só grava (1 UPDATE)
      // quando algo realmente mudou, então o custo extra é próximo de zero na maioria das
      // sincronizações (poucas transações do último mês mudam de um sync para o outro).
      for (const tx of allPluggyTxs) {
        const existing = existingByPluggyId.get(tx.id);
        if (!existing) continue;
        const freshDate = tx.date.toISOString().split('T')[0];
        const freshAmount = toCents(tx.amount);
        if (existing.name !== tx.description || existing.date !== freshDate || existing.amount !== freshAmount) {
          await prisma.transaction.updateMany({
            where: { userId, pluggyId: tx.id },
            data: { name: tx.description, date: freshDate, amount: freshAmount },
          });
        }
      }

      if (newPluggyTxs.length > 0) {
        const data = newPluggyTxs.map(tx => ({
          userId,
          accountId: localAccount.id,
          pluggyId: tx.id,
          name: tx.description,
          category: tx.category || 'Outros',
          date: tx.date.toISOString().split('T')[0],
          amount: toCents(tx.amount),
        }));
        try {
          await prisma.transaction.createMany({ data });
        } catch (err) {
          // Corrida rara: outra sincronização inseriu a mesma transação entre o
          // `findMany` acima e este `createMany` (que, ao contrário de `create`
          // individual, falha inteiro — não por linha — ao violar a constraint única, e
          // o SQLite não suporta `skipDuplicates` no Prisma). Cai para upsert linha a
          // linha só neste caso raro, protegido pela constraint (ver FIN-021) — e também
          // atualiza os dados no conflito, para ficar consistente com o loop de refresh acima.
          if (err.code === 'P2002') {
            for (const t of data) {
              await prisma.transaction.upsert({
                where: { userId_pluggyId: { userId, pluggyId: t.pluggyId } },
                create: t,
                update: { name: t.name, category: t.category, date: t.date, amount: t.amount },
              });
            }
          } else {
            throw err;
          }
        }
      }

      // Nota: reconciliação de transações removidas/substituídas do lado da Pluggy (ex.:
      // uma transação pendente que desaparece e é substituída por outra com ID diferente)
      // fica fora do escopo desta correção — exigiria comparar todo o histórico já
      // importado contra a janela de datas retornada pela Pluggy para decidir com segurança
      // o que apagar, e um erro nessa lógica apagaria transações reais do usuário. Preferível
      // tratar como item de backlog dedicado a ser desenhado com mais cuidado.
    }

    res.json({ success: true, message: `Sincronizacao concluida! ${totalTxs} novas transacoes importadas.` });
  } catch (error) {
    sendInternalError(res, error, 'Erro na sincronização de dados.');
  }
});

// Só sobe o servidor de verdade quando este arquivo é executado diretamente (`node
// server.js`/`nodemon server.js`) — não quando é importado por um teste (ver FIN-031 em
// docs/BACKLOG_DETAIL.md). `app` é exportado para que os testes de integração (Supertest)
// façam requisições contra ele em memória, sem abrir uma porta TCP real nem depender de um
// servidor já rodando.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    console.log(`Finance Dashboard API Proxy running on http://localhost:${PORT}`);
  });
}

// `prisma` também exportado para que os testes possam chamar `$disconnect()` no
// `afterAll` — sem isso, better-sqlite3 mantém o arquivo aberto e a limpeza do banco de
// teste (`unlink`) falha com `EBUSY` no Windows (ver FIN-031).
export { app, prisma, pluggyReauthMessage };
