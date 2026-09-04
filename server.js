import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { PluggyClient } from 'pluggy-sdk';
import crypto from 'crypto';

dotenv.config();

const app = express();
app.use(cors());
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

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  
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
    if (existingUser) return res.status(400).json({ error: 'Email já cadastrado.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, passwordHash },
    });

    const token = jwt.sign({ userId: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar usuário', details: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

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

    const token = jwt.sign({ userId: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao realizar login', details: error.message });
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
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/accounts', authenticateToken, async (req, res) => {
  try {
    const data = { ...req.body, userId: req.user.userId };
    if (data.id) delete data.id; // ensure new real id is generated or use the given one if valid
    const acc = await prisma.account.create({ data });
    res.json(acc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/accounts/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const data = { ...req.body };
    delete data.id;
    delete data.userId;
    delete data.createdAt;

    const acc = await prisma.account.updateMany({
      where: { id, userId: req.user.userId },
      data,
    });
    res.json({ success: true, changes: acc.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/accounts/:id', authenticateToken, async (req, res) => {
  try {
    await prisma.account.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const { transactions } = req.body;
    // Supports batch insert
    if (Array.isArray(transactions)) {
      const userId = req.user.userId;
      const mapped = transactions.map(t => {
        const { id, ...rest } = t;
        const data = { ...rest, userId };
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
    } else {
      const data = { ...req.body, userId: req.user.userId };
      if (data.id) delete data.id;
      const tx = await prisma.transaction.create({ data });
      res.json(tx);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/transactions/bulk', authenticateToken, async (req, res) => {
  try {
    await prisma.transaction.deleteMany({ where: { userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/debts', authenticateToken, async (req, res) => {
  try {
    const data = { ...req.body, userId: req.user.userId };
    if (data.id) delete data.id;
    const subItems = data.subItems;
    delete data.subItems;

    const debt = await prisma.debt.create({
      data: {
        ...data,
        subItems: subItems ? { create: subItems.map(s => ({ name: s.name, amount: s.amount, date: s.date })) } : undefined
      },
      include: { subItems: true }
    });
    res.json(debt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/debts/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const data = { ...req.body };
    delete data.id;
    delete data.userId;
    delete data.createdAt;
    delete data.subItems;

    // Converte tipos se forem passados como strings
    if (data.totalAmount !== undefined) data.totalAmount = parseFloat(data.totalAmount) || 0;
    if (data.paidAmount !== undefined) data.paidAmount = parseFloat(data.paidAmount) || 0;
    if (data.monthlyPayment !== undefined) data.monthlyPayment = parseFloat(data.monthlyPayment) || 0;
    if (data.totalInstallments !== undefined) data.totalInstallments = parseInt(data.totalInstallments) || 1;
    if (data.paidInstallments !== undefined) data.paidInstallments = parseInt(data.paidInstallments) || 0;
    if (data.interestRate !== undefined) data.interestRate = parseFloat(data.interestRate) || 0;
    if (data.accountId === '') data.accountId = null;

    const debt = await prisma.debt.update({
      where: { id, userId: req.user.userId },
      data,
      include: { subItems: true }
    });
    res.json(debt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/debts/:id', authenticateToken, async (req, res) => {
  try {
    // Delete subitems first via cascading or manual delete due to sqlite limitations if not setup
    await prisma.debtItem.deleteMany({ where: { debt: { id: req.params.id, userId: req.user.userId } }});
    await prisma.debt.deleteMany({ where: { id: req.params.id, userId: req.user.userId } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    console.error('Erro ao gerar Connect Token:', error);
    res.status(500).json({ error: 'Erro ao conectar à API da Pluggy', details: error.message });
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
    console.error('Erro ao registrar item Pluggy:', error);
    res.status(500).json({ error: 'Erro ao registrar conexão bancária', details: error.message });
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
            balance: pluggyAcc.balance,
            color: '#6366f1',
          }
        });
      } else {
        await prisma.account.updateMany({
          where: { id: localAccount.id, userId },
          data: { balance: pluggyAcc.balance, name: pluggyAcc.name }
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
              data: { pendingBill: currentBill.totalAmount },
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
              amount: tx.amount,
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
              amount: tx.amount,
            }
          });
        }
      }
    }

    res.json({ success: true, message: `Sincronizacao concluida! ${totalTxs} novas transacoes importadas.` });
  } catch (error) {
    console.error('Erro na sincronizacao Pluggy:', error);
    res.status(500).json({ error: 'Erro na sincronizacao de dados', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Finance Dashboard API Proxy running on http://localhost:${PORT}`);
});
