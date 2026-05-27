import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import { PluggyClient } from 'pluggy-sdk';
import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const PORT = 3002;

// 1. Configuração do SQLite local (arquivo sandbox.db será criado automaticamente)
const db = new Database('sandbox.db');

// 2. Inicialização do Cliente SDK da Pluggy
const pluggyClient = new PluggyClient({
  clientId: process.env.PLUGGY_CLIENT_ID,
  clientSecret: process.env.PLUGGY_CLIENT_SECRET,
});

// ID de usuário mockado (para simular a sessão de um usuário autenticado)
const MOCK_USER_ID = '33ea06b1-096a-4d7a-8f1b-31d2be6a9fb4';

// 3. Inicialização automática das Tabelas no SQLite local
const initDatabase = () => {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS bank_connections (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          pluggy_item_id TEXT NOT NULL UNIQUE,
          provider_name TEXT NOT NULL,
          image_url TEXT,
          status TEXT DEFAULT 'ACTIVE',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          pluggy_account_id TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          bank TEXT NOT NULL,
          type TEXT NOT NULL,
          balance REAL NOT NULL DEFAULT 0.00,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS transactions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
          pluggy_transaction_id TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          date TEXT NOT NULL,
          amount REAL NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabelas no SQLite local verificadas/criadas com sucesso.');
  } catch (error) {
    console.error('❌ Erro ao inicializar o banco de dados SQLite:', error);
  }
};
initDatabase();

/**
 * ROTA: POST /api/pluggy/connect-token
 * Gera o token temporário (válido por 30min) de conexão do Widget
 */
app.post('/api/pluggy/connect-token', async (req, res) => {
  try {
    const response = await pluggyClient.createConnectToken(undefined, {
      clientUserId: MOCK_USER_ID,
    });
    res.json({ accessToken: response.accessToken });
  } catch (error) {
    console.error('Erro ao gerar Connect Token:', error);
    res.status(500).json({ error: 'Erro ao conectar à API da Pluggy', details: error.message });
  }
});

/**
 * ROTA: POST /api/pluggy/connect-item
 * Recebe o 'itemId' gerado pelo widget, busca detalhes do Banco na Pluggy e salva no DB
 */
app.post('/api/pluggy/connect-item', async (req, res) => {
  const { itemId } = req.body;
  if (!itemId) {
    return res.status(400).json({ error: 'O parâmetro itemId é obrigatório.' });
  }

  try {
    // 1. Busca os detalhes da conexão (item) na Pluggy
    const pluggyItem = await pluggyClient.fetchItem(itemId);

    // 2. Salva ou atualiza a conexão na tabela 'bank_connections'
    const stmt = db.prepare(`
      INSERT INTO bank_connections (id, user_id, pluggy_item_id, provider_name, image_url, status)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (pluggy_item_id) 
      DO UPDATE SET status = EXCLUDED.status, updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run(
      crypto.randomUUID(),
      MOCK_USER_ID,
      itemId,
      pluggyItem.connector.name,
      pluggyItem.connector.imageUrl,
      pluggyItem.status
    );

    res.json({ success: true, itemId });
  } catch (error) {
    console.error('Erro ao registrar conexão:', error);
    res.status(500).json({ error: 'Erro ao registrar conexão bancária', details: error.message });
  }
});

/**
 * ROTA: POST /api/pluggy/sync/:itemId
 * Busca as contas e transações da Pluggy e faz o 'upsert' no banco para evitar duplicidade
 */
app.post('/api/pluggy/sync/:itemId', async (req, res) => {
  const { itemId } = req.params;

  try {
    console.log(`Buscando contas para o itemId: ${itemId}...`);
    const accountsRes = await pluggyClient.fetchAccounts(itemId);

    if (!accountsRes.results || accountsRes.results.length === 0) {
      return res.status(404).json({ error: 'Nenhuma conta encontrada para o item fornecido.' });
    }

    // Processa cada conta retornada
    for (const pluggyAcc of accountsRes.results) {
      // 1. Salva ou atualiza a conta bancária
      const uuid = crypto.randomUUID();
      
      const insertAccountStmt = db.prepare(`
        INSERT INTO accounts (id, user_id, pluggy_account_id, name, bank, type, balance)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (pluggy_account_id)
        DO UPDATE SET balance = EXCLUDED.balance, name = EXCLUDED.name
      `);

      insertAccountStmt.run(
        uuid,
        MOCK_USER_ID,
        pluggyAcc.id,
        pluggyAcc.name,
        pluggyAcc.marketingName || 'Banco Sandbox',
        pluggyAcc.type.toLowerCase(),
        pluggyAcc.balance
      );

      // Busca a ID local da conta no SQLite
      const getAccountStmt = db.prepare('SELECT id FROM accounts WHERE pluggy_account_id = ?');
      const dbAccount = getAccountStmt.get(pluggyAcc.id);
      const dbAccountId = dbAccount.id;

      // 2. Busca transações do último mês desta conta
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      const fromDate = oneMonthAgo.toISOString().split('T')[0];

      console.log(`Buscando transações da conta ${pluggyAcc.name} desde ${fromDate}...`);
      const txsRes = await pluggyClient.fetchTransactions(pluggyAcc.id, { from: fromDate });

      // 3. Salva ou atualiza as transações utilizando ON CONFLICT (evita duplicações)
      const insertTxStmt = db.prepare(`
        INSERT INTO transactions (id, user_id, account_id, pluggy_transaction_id, name, category, date, amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (pluggy_transaction_id)
        DO UPDATE SET 
          name = EXCLUDED.name,
          category = EXCLUDED.category,
          date = EXCLUDED.date,
          amount = EXCLUDED.amount
      `);

      for (const tx of txsRes.results) {
        insertTxStmt.run(
          crypto.randomUUID(),
          MOCK_USER_ID,
          dbAccountId,
          tx.id,
          tx.description,
          tx.category || 'Outros',
          tx.date.toISOString().split('T')[0],
          tx.amount
        );
      }
    }

    res.json({ 
      success: true, 
      message: `Sincronização do itemId ${itemId} concluída! Contas e transações atualizadas sem duplicidade.` 
    });
  } catch (error) {
    console.error('Erro durante a sincronização:', error);
    res.status(500).json({ error: 'Erro na sincronização de dados', details: error.message });
  }
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor Sandbox (SQLite) rodando em http://localhost:${PORT}`);
});
