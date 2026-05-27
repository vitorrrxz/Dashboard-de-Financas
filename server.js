import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { PluggyClient } from 'pluggy-sdk';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;
const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || 'file:./dev.db',
});
const prisma = new PrismaClient({ adapter });
const JWT_SECRET = process.env.JWT_SECRET || 'chave_secreta_finance_app';

// Pluggy Client — inicializado com as credenciais do .env
const pluggyClient = new PluggyClient({
  clientId: process.env.PLUGGY_CLIENT_ID || '',
  clientSecret: process.env.PLUGGY_CLIENT_SECRET || '',
});

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
      const mapped = transactions.map(t => {
        const { id, ...rest } = t;
        return { ...rest, userId: req.user.userId };
      });
      await prisma.transaction.createMany({ data: mapped });
      res.json({ success: true, count: mapped.length });
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
            type: pluggyAcc.type.toLowerCase(),
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
