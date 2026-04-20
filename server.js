import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PluggyClient } from 'pluggy-sdk';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'chave_secreta_finance_app';

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
/*                               PLUGGY OPEN FINANCE                          */
/* -------------------------------------------------------------------------- */

app.post('/api/pluggy/token', authenticateToken, async (req, res) => {
  try {
    const data = await pluggyClient.createConnectToken();
    res.json({ accessToken: data.accessToken });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate token', details: error.message });
  }
});

app.get('/api/pluggy/sync', authenticateToken, async (req, res) => {
  try {
    const { itemId } = req.query;
    if (!itemId) return res.status(400).json({ error: 'Missing itemId parameter' });

    const accountsResponse = await pluggyClient.fetchAccounts(itemId);
    const pluggyAccounts = accountsResponse.results || [];

    let transactions = [];
    for (const acc of pluggyAccounts) {
      try {
        const txs = await pluggyClient.fetchAllTransactions(acc.id);
        transactions = transactions.concat(txs);
      } catch(e) { }
    }

    const { userId } = req.user;

    // 1. Save mapped Accounts to Database
    const savedAccounts = [];
    for (const pa of pluggyAccounts) {
      const typeStr = pa.type === 'CREDIT' ? 'credit' : 'checking';
      
      const acc = await prisma.account.create({
        data: {
          userId,
          pluggyId: pa.id,
          name: pa.name,
          bank: pa.bankData?.name || 'Open Finance',
          type: typeStr,
          balance: pa.balance,
          limit: pa.creditData?.creditLimit || null,
          color: '#14b8a6', 
        }
      });
      savedAccounts.push(acc);
    }
    
    // Create a map to attach accountId locally
    const pluggyToLocalAccMap = {};
    savedAccounts.forEach(sa => { pluggyToLocalAccMap[sa.pluggyId] = sa.id; });

    // 2. Save Transactions to Database
    const savedTransactions = [];
    if (transactions.length > 0) {
      const txsData = transactions.map(pt => ({
        userId,
        pluggyId: pt.id,
        accountId: pluggyToLocalAccMap[pt.accountId] || null,
        name: pt.description,
        category: pt.categoryId || 'Outros',
        date: pt.date?.substring(0, 10) || new Date().toISOString().substring(0,10),
        amount: pt.amount,
      }));
      await prisma.transaction.createMany({ data: txsData });
      
      // Just returning what was created directly 
      // though typically we'd fetch them back but mapped is fine
      savedTransactions.push(...txsData);
    }

    res.json({ accounts: savedAccounts, transactions: savedTransactions });
  } catch (error) {
    console.error('Error syncing pluggy', error);
    res.status(500).json({ error: 'Failed to sync data', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Finance Dashboard API Proxy running on http://localhost:${PORT}`);
});
