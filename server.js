import './server/lib/env.js';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import helmet from 'helmet';
import { fileURLToPath } from 'url';
import { runBackupSafely } from './scripts/backup-db.mjs';

import { prisma } from './server/lib/prisma.js';
import {
  pluggyReauthMessage, pluggyAmountToCents, isCreditCardBillPayment, pluggyTransactionCategory,
  pluggyCurrency, pluggyBillDueDay, OWN_TRANSFER_CATEGORIES,
} from './server/lib/pluggyHelpers.js';
import { nextBillDueDate, buildDueNotifications, detectUnusualSpending } from './server/lib/notificationsCore.js';
import { formatCents, SUPPORTED_CURRENCIES } from './server/lib/money.js';
import { parseProviderRates, createExchangeRateCache } from './server/lib/exchangeRates.js';
import { sendInternalError } from './server/lib/http.js';

import { router as authRouter, encryptTwoFactorSecret, decryptTwoFactorSecret } from './server/routes/auth.js';
import { router as accountsRouter } from './server/routes/accounts.js';
import { router as transactionsRouter } from './server/routes/transactions.js';
import { router as debtsRouter } from './server/routes/debts.js';
import { router as budgetsRouter } from './server/routes/budgets.js';
import { router as goalsRouter } from './server/routes/goals.js';
import { router as investmentsRouter } from './server/routes/investments.js';
import { router as exchangeRatesRouter } from './server/routes/exchangeRates.js';
import { router as netWorthRouter } from './server/routes/netWorth.js';
import { router as categoryRulesRouter } from './server/routes/categoryRules.js';
import { router as recurringRouter } from './server/routes/recurring.js';
import { router as notificationsRouter } from './server/routes/notifications.js';
import { router as backupRouter } from './server/routes/backup.js';
import { router as pluggyRouter } from './server/routes/pluggy.js';

const app = express();
// FIN-108 — no contêiner, a API serve também o build do frontend (`FRONTEND_DIR`), na mesma origem (ver
// o fim do arquivo). Sem a variável, como no desenvolvimento, quem serve o frontend é o Vite.
const FRONTEND_DIR = process.env.FRONTEND_DIR ? path.resolve(process.env.FRONTEND_DIR) : null;
const FRONTEND_INDEX = FRONTEND_DIR ? fs.readFileSync(path.join(FRONTEND_DIR, 'index.html'), 'utf8') : '';
// Hash de cada script embutido no index.html (o do tema, FIN-083), tirado do próprio arquivo servido:
// mudar o script não deixa a CSP para trás. O navegador faz a conta com as quebras de linha já em LF, e
// um checkout no Windows traz o arquivo com CRLF.
const inlineScriptHashes = [...FRONTEND_INDEX.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(([, code]) => `'sha256-${crypto.createHash('sha256').update(code.replace(/\r\n?/g, '\n')).digest('base64')}'`);
// Cabeçalhos de segurança HTTP (FIN-010). A CSP padrão do helmet barraria a página: o script de tema, o
// widget da Pluggy — script no CDN dela, tela num iframe de connect.pluggy.ai — e, no acesso em HTTP pelo
// IP da rede, todos os arquivos, que ela manda o navegador pedir por HTTPS.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      scriptSrc: ["'self'", 'https://cdn.pluggy.ai', ...inlineScriptHashes],
      frameSrc: ['https://connect.pluggy.ai'],
      upgradeInsecureRequests: null,
    },
  },
  // O widget da Pluggy pode abrir o login do banco numa janela nova (`window.open`) e precisa falar com ela.
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));
// CORS restrito à origem conhecida do frontend — evita que qualquer site de terceiros
// consiga ler respostas desta API (ver FIN-009 em docs/BACKLOG_DETAIL.md).
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
// Corpo JSON de até 100 kB (padrão do Express) em todas as rotas, menos a restauração de backup
// (FIN-080): ela recebe o arquivo inteiro e usa um parser próprio, com limite maior, que só roda
// depois da autenticação — ver a rota, em server/routes/backup.js.
const BACKUP_IMPORT_PATH = '/api/account/import';
// Sem caixa e sem barra final, porque o roteamento do Express também ignora as duas.
function isBackupImportPath(req) {
  return req.path.replace(/\/+$/, '').toLowerCase() === BACKUP_IMPORT_PATH;
}
const jsonBody = express.json();
app.use((req, res, next) => (isBackupImportPath(req) ? next() : jsonBody(req, res, next)));

const PORT = 3001;

app.use('/api/auth', authRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/debts', debtsRouter);
app.use('/api/budgets', budgetsRouter);
app.use('/api/goals', goalsRouter);
app.use('/api/investments', investmentsRouter);
app.use('/api/exchange-rates', exchangeRatesRouter);
app.use('/api/net-worth', netWorthRouter);
app.use('/api/category-rules', categoryRulesRouter);
app.use('/api/recurring-transactions', recurringRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/account', backupRouter);
app.use('/api/pluggy', pluggyRouter);

// FIN-108 — o build do frontend, na mesma origem da API. Caminho sem extensão fora de /api recebe o
// index.html (a SPA decide a tela); arquivo que não existe dá 404, e não a página no lugar de um script.
if (FRONTEND_DIR) {
  app.use(express.static(FRONTEND_DIR, { index: false }));
  app.get(/^\/(?!api(?:\/|$))[^.]*$/i, (req, res) => res.type('html').send(FRONTEND_INDEX));
}

// Erros que escapam das rotas — em especial os do parser de JSON (corpo malformado ou grande
// demais) — respondem em JSON, como o resto da API. Sem este tratador, iam para o padrão do
// Express, que responde uma página HTML, com a pilha do erro fora de produção (ver FIN-011).
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      error: isBackupImportPath(req)
        ? 'O arquivo de backup passa do tamanho máximo aceito (25 MB).'
        : 'Os dados enviados passam do tamanho máximo aceito.',
    });
  }
  const status = Number(err?.status ?? err?.statusCode);
  if (status >= 400 && status < 500) {
    return res.status(status).json({
      error: err?.type === 'entity.parse.failed' ? 'O corpo da requisição não é um JSON válido.' : 'Requisição inválida.',
    });
  }
  sendInternalError(res, err);
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
  // FIN-102 — cópia do banco ao subir e a cada 24 h; sem BACKUP_DIR, desligado.
  if (process.env.BACKUP_DIR) {
    runBackupSafely();
    setInterval(runBackupSafely, 24 * 60 * 60 * 1000);
  }
}

// FIN-115 — server.js virou só a montagem do app: middlewares globais, os routers por domínio
// (server/routes/*.js) e o assentamento do frontend. Cada domínio (auth/2FA, contas, transações,
// dívidas, orçamento, metas, recorrências, investimentos, notificações, backup, Pluggy) mora no seu
// próprio arquivo, com os utilitários compartilhados em server/lib/*.js — mesmo comportamento de
// antes, só que revisável em pedaços menores (ver docs/BACKLOG_DETAIL.md).
//
// `prisma` também exportado para que os testes possam chamar `$disconnect()` no
// `afterAll` — sem isso, better-sqlite3 mantém o arquivo aberto e a limpeza do banco de
// teste (`unlink`) falha com `EBUSY` no Windows (ver FIN-031). O restante da lista são
// funções puras que os testes de unidade importam diretamente daqui, sem subir o app inteiro.
export {
  app, prisma, pluggyReauthMessage, pluggyAmountToCents, isCreditCardBillPayment, pluggyTransactionCategory,
  nextBillDueDate, pluggyBillDueDay, buildDueNotifications, detectUnusualSpending,
  pluggyCurrency, formatCents, SUPPORTED_CURRENCIES, parseProviderRates, createExchangeRateCache,
  encryptTwoFactorSecret, decryptTwoFactorSecret, OWN_TRANSFER_CATEGORIES,
};
