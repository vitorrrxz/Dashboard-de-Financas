import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticateToken, authLimiter } from '../lib/auth.js';
import { sendInternalError } from '../lib/http.js';
import { BASE_CURRENCY, CURRENCY_CODE_PATTERN } from '../lib/money.js';
import { todayISO } from '../lib/dates.js';
import {
  accountSchema, transactionSchema, debtSchema, budgetSchema, goalSchema, recurringSchema,
  investmentSchema, categoryRuleSchema,
} from '../lib/schemas.js';

export const router = express.Router();

/* -------------------------------------------------------------------------- */
/*                   BACKUP E RESTAURAÇÃO (FIN-079/FIN-080)                   */
/* -------------------------------------------------------------------------- */
// Arquivo: { format, version, exportedAt, user: { name, email }, data: { accounts, transactions,
// debts (com subItems), budgets, goals, recurring, investments } }, com os valores em centavos,
// como no banco. Ficam de fora a senha, a verificação em duas etapas (segredos não saem do
// servidor) e as notificações, que são derivadas dos dados e voltam a ser geradas. As linhas não
// levam `userId`: o arquivo não carrega a identidade interna de ninguém.
const BACKUP_FORMAT = 'finflow-backup';
const BACKUP_VERSION = 1;
// Limite do corpo da restauração — cerca de 100 mil transações cabem com folga.
const BACKUP_BODY_LIMIT = '25mb';
const MAX_BACKUP_ROWS = 100_000;
// Seções do arquivo, com o nome de cada registro no singular e no plural (mensagens de erro).
const BACKUP_SECTIONS = {
  accounts: ['conta', 'contas'],
  transactions: ['transação', 'transações'],
  debts: ['dívida', 'dívidas'],
  budgets: ['orçamento', 'orçamentos'],
  goals: ['meta', 'metas'],
  recurring: ['recorrência', 'recorrências'],
  investments: ['investimento', 'investimentos'],
  categoryRules: ['regra de categoria', 'regras de categoria'],
};

async function buildBackup(userId) {
  // Numa única transação de leitura: o arquivo é um retrato consistente mesmo com um sync da
  // Pluggy gravando ao mesmo tempo. O `id` no fim de cada ordenação desempata registros criados
  // no mesmo milissegundo, para dois backups dos mesmos dados saírem idênticos.
  const byCreation = [{ createdAt: 'asc' }, { id: 'asc' }];
  const [user, accounts, transactions, debts, budgets, goals, recurring, investments, categoryRules] = await prisma.$transaction([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    prisma.account.findMany({ where: { userId }, orderBy: byCreation }),
    prisma.transaction.findMany({ where: { userId }, orderBy: [{ date: 'asc' }, ...byCreation] }),
    prisma.debt.findMany({
      where: { userId },
      orderBy: byCreation,
      include: { subItems: { orderBy: [{ date: 'asc' }, { name: 'asc' }, { amount: 'asc' }] } },
    }),
    prisma.budget.findMany({ where: { userId }, orderBy: byCreation }),
    prisma.goal.findMany({ where: { userId }, orderBy: byCreation }),
    prisma.recurringTransaction.findMany({ where: { userId }, orderBy: byCreation }),
    prisma.investment.findMany({ where: { userId }, orderBy: byCreation }),
    prisma.categoryRule.findMany({ where: { userId }, orderBy: byCreation }),
  ]);
  if (!user) return null;
  const withoutUser = ({ userId: _userId, ...row }) => row;
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    user,
    data: {
      accounts: accounts.map(withoutUser),
      transactions: transactions.map(withoutUser),
      debts: debts.map(({ userId: _userId, subItems, ...debt }) => ({
        ...debt,
        subItems: subItems.map(({ name, amount, date }) => ({ name, amount, date })),
      })),
      budgets: budgets.map(withoutUser),
      goals: goals.map(withoutUser),
      recurring: recurring.map(withoutUser),
      investments: investments.map(withoutUser),
      categoryRules: categoryRules.map(withoutUser),
    },
  };
}

router.get('/export', authenticateToken, async (req, res) => {
  try {
    const backup = await buildBackup(req.user.userId);
    if (!backup) return res.status(404).json({ error: 'Usuário não encontrado.' });
    res.setHeader('Content-Disposition', `attachment; filename="finflow-backup-${todayISO()}.json"`);
    // Dados financeiros completos: nenhum cache (navegador, proxy ou service worker) guarda a resposta.
    res.setHeader('Cache-Control', 'no-store');
    res.json(backup);
  } catch (err) {
    sendInternalError(res, err, 'Erro ao gerar o backup.');
  }
});

// As linhas do arquivo reaproveitam os schemas das rotas (FIN-008), com três ajustes: o `id`
// original (para refazer os vínculos entre contas e lançamentos), as datas de criação, e os campos
// que o sync da Pluggy grava sem passar por aquelas regras — o nome de uma conta ou transação pode
// vir vazio do banco, e a moeda de uma conta pode ser qualquer código ISO (`pluggyCurrency`).
// Recusar esses valores tornaria impossível restaurar um backup legítimo.
const backupIdField = z.string({ error: 'Identificador ausente.' }).regex(/^[A-Za-z0-9_-]{1,64}$/, 'Identificador inválido.');
const backupAccountRef = z.preprocess(v => (v === '' ? null : v), backupIdField.nullable().optional());
const backupDateField = z.iso.datetime({ message: 'Data inválida.' }).transform(value => new Date(value)).optional();
const backupCurrencyField = z.string().regex(CURRENCY_CODE_PATTERN, 'Moeda deve ser um código ISO de 3 letras.').optional();
const backupExternalKey = z.string().trim().min(1).max(200).nullable().optional();

const backupAccountSchema = accountSchema.extend({
  id: backupIdField,
  pluggyId: backupExternalKey,
  name: z.string().max(500),
  currency: backupCurrencyField,
  createdAt: backupDateField,
});
// Sem `currency`: como em toda gravação de transação, a moeda vem da conta (FIN-074).
const backupTransactionSchema = transactionSchema.omit({ externalId: true }).extend({
  id: backupIdField,
  accountId: backupAccountRef,
  pluggyId: backupExternalKey,
  importHash: backupExternalKey,
  name: z.string().max(500),
  createdAt: backupDateField,
});
const backupDebtSchema = debtSchema.extend({ id: backupIdField, accountId: backupAccountRef, createdAt: backupDateField });
const backupBudgetSchema = budgetSchema.extend({ id: backupIdField, createdAt: backupDateField });
// FIN-113 — `investmentId` no arquivo passa pela mesma regra de `accountId` (id opcional, "" vira
// null): o formato é genérico, só o campo que muda.
const backupGoalSchema = goalSchema.extend({
  id: backupIdField, accountId: backupAccountRef, investmentId: backupAccountRef, createdAt: backupDateField,
});
const backupRecurringSchema = recurringSchema.extend({ id: backupIdField, accountId: backupAccountRef, createdAt: backupDateField });
const backupInvestmentSchema = investmentSchema.extend({
  id: backupIdField,
  accountId: backupAccountRef,
  currency: backupCurrencyField,
  createdAt: backupDateField,
  updatedAt: backupDateField,
});

const backupCategoryRuleSchema = categoryRuleSchema.extend({ id: backupIdField, createdAt: backupDateField });

const backupRows = schema => z.array(schema).max(MAX_BACKUP_ROWS, `mais de ${MAX_BACKUP_ROWS} registros.`);
const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT, { message: 'O arquivo não é um backup do FinFlow.' }),
  version: z.literal(BACKUP_VERSION, { message: 'Versão de backup não suportada.' }),
  data: z.object({
    accounts: backupRows(backupAccountSchema),
    transactions: backupRows(backupTransactionSchema),
    debts: backupRows(backupDebtSchema),
    budgets: backupRows(backupBudgetSchema),
    goals: backupRows(backupGoalSchema),
    recurring: backupRows(backupRecurringSchema),
    investments: backupRows(backupInvestmentSchema),
    // FIN-105 — ausente nos backups de antes das regras de categoria: vale como lista vazia.
    categoryRules: backupRows(backupCategoryRuleSchema).default([]),
  }),
});

/** "transação nº 2" — posição de um registro no arquivo, para as mensagens de erro. */
function backupRowLabel(section, index) {
  return `${BACKUP_SECTIONS[section][0]} nº ${index + 1}`;
}

/** Mensagem legível dos três primeiros problemas de validação, com a posição de cada um no arquivo. */
function backupIssueMessage(issues) {
  const describe = issue => {
    const [root, section, index, field] = issue.path;
    const text = (issue.code === 'invalid_type' ? 'valor ausente ou com tipo errado' : issue.message).replace(/\.$/, '');
    if (root !== 'data') return text;
    if (section === undefined) return 'o arquivo não tem a seção de dados';
    if (!Object.prototype.hasOwnProperty.call(BACKUP_SECTIONS, section)) return text;
    if (typeof index !== 'number') return `seção de ${BACKUP_SECTIONS[section][1]}: ${text}`;
    return `${backupRowLabel(section, index)}${field !== undefined ? ` (${String(field)})` : ''}: ${text}`;
  };
  const shown = issues.slice(0, 3).map(describe).join('; ');
  const more = issues.length > 3 ? ` — e mais ${issues.length - 3} problema(s)` : '';
  return `Backup inválido: ${shown}${more}.`;
}

/**
 * Coerência interna do arquivo, conferida antes de apagar qualquer coisa: ids repetidos, vínculo
 * com conta ou investimento que não está no arquivo, investimento (ou meta, FIN-113) em cartão de
 * crédito, meta vinculada aos dois ao mesmo tempo, e as constraints únicas do banco — sem esta
 * checagem, a violação só apareceria no meio da gravação. Devolve a mensagem do primeiro
 * problema, ou `null`.
 */
function backupConsistencyError(data) {
  for (const section of Object.keys(BACKUP_SECTIONS)) {
    const seen = new Set();
    for (const [index, row] of data[section].entries()) {
      if (seen.has(row.id)) return `${backupRowLabel(section, index)}: identificador repetido no arquivo.`;
      seen.add(row.id);
    }
  }
  const accountTypes = new Map(data.accounts.map(account => [account.id, account.type]));
  for (const section of ['transactions', 'debts', 'recurring', 'investments', 'goals']) {
    for (const [index, row] of data[section].entries()) {
      if (row.accountId && !accountTypes.has(row.accountId)) {
        return `${backupRowLabel(section, index)}: aponta para uma conta que não está no arquivo.`;
      }
    }
  }
  for (const [index, investment] of data.investments.entries()) {
    if (investment.accountId && accountTypes.get(investment.accountId) === 'credit') {
      return `${backupRowLabel('investments', index)}: vinculado a um cartão de crédito.`;
    }
  }
  // FIN-113 — mesmas checagens da rota para o vínculo (opcional) da meta com conta ou investimento.
  const investmentIds = new Set(data.investments.map(investment => investment.id));
  for (const [index, goal] of data.goals.entries()) {
    if (goal.accountId && goal.investmentId) {
      return `${backupRowLabel('goals', index)}: vinculada a uma conta e a um investimento ao mesmo tempo.`;
    }
    if (goal.accountId && accountTypes.get(goal.accountId) === 'credit') {
      return `${backupRowLabel('goals', index)}: vinculada a um cartão de crédito.`;
    }
    if (goal.investmentId && !investmentIds.has(goal.investmentId)) {
      return `${backupRowLabel('goals', index)}: aponta para um investimento que não está no arquivo.`;
    }
  }
  const uniqueKeys = [
    ['budgets', 'category', 'categoria repetida'],
    ['categoryRules', 'match', 'regra repetida'],
    ['accounts', 'pluggyId', 'conta da Pluggy repetida'],
    ['transactions', 'pluggyId', 'transação da Pluggy repetida'],
    ['transactions', 'importHash', 'transação importada repetida'],
  ];
  for (const [section, key, problem] of uniqueKeys) {
    const seen = new Set();
    for (const [index, row] of data[section].entries()) {
      const value = row[key];
      if (value == null) continue;
      if (seen.has(value)) return `${backupRowLabel(section, index)}: ${problem}.`;
      seen.add(value);
    }
  }
  return null;
}

/**
 * Algum id do arquivo já pertence a outro usuário? Acontece quando o backup de uma pessoa é
 * restaurado na conta de outra, no mesmo servidor. Consulta em lotes de 500 ids, abaixo do
 * limite de parâmetros do SQLite.
 */
async function backupIdsTakenByOthers(userId, data) {
  const models = {
    accounts: prisma.account, transactions: prisma.transaction, debts: prisma.debt, budgets: prisma.budget,
    goals: prisma.goal, recurring: prisma.recurringTransaction, investments: prisma.investment, categoryRules: prisma.categoryRule,
  };
  for (const [section, model] of Object.entries(models)) {
    const ids = data[section].map(row => row.id);
    for (let i = 0; i < ids.length; i += 500) {
      const taken = await model.count({ where: { id: { in: ids.slice(i, i + 500) }, userId: { not: userId } } });
      if (taken > 0) return true;
    }
  }
  return false;
}

/**
 * Linhas a gravar para `userId`. Com `reuseIds`, os ids do arquivo são mantidos: a restauração
 * devolve os dados exatamente como eram — inclusive a chave de deduplicação das importações de
 * extrato, que inclui o id da conta. Sem, cada registro ganha um id novo e os vínculos com as
 * contas são refeitos pelo mapa. O `userId` é sempre o de quem restaura, nunca o do arquivo.
 */
function buildRestoreRows(userId, data, reuseIds) {
  const newId = id => (reuseIds ? id : crypto.randomUUID());
  const accountIds = new Map(data.accounts.map(account => [account.id, newId(account.id)]));
  const accountCurrency = new Map(data.accounts.map(account => [account.id, account.currency ?? BASE_CURRENCY]));
  const accountRef = accountId => (accountId ? accountIds.get(accountId) : null);
  // FIN-113 — mesmo mapa de ids, para o vínculo (opcional) da meta com um investimento sobreviver
  // à restauração (o investimento também ganha um id novo, calculado abaixo).
  const investmentIds = new Map(data.investments.map(investment => [investment.id, newId(investment.id)]));
  const investmentRef = investmentId => (investmentId ? investmentIds.get(investmentId) : null);

  const debtItems = [];
  return {
    accounts: data.accounts.map(({ id, ...account }) => ({
      ...account, id: accountIds.get(id), userId, currency: account.currency ?? BASE_CURRENCY,
    })),
    transactions: data.transactions.map(({ id, accountId, ...tx }) => ({
      paymentType: 'debit',
      ...tx,
      id: newId(id),
      userId,
      accountId: accountRef(accountId),
      currency: accountId ? accountCurrency.get(accountId) : BASE_CURRENCY,
    })),
    debts: data.debts.map(({ id, accountId, subItems, ...debt }) => {
      const debtId = newId(id);
      for (const item of subItems ?? []) debtItems.push({ ...item, debtId });
      return { paidAmount: 0, paidInstallments: 0, ...debt, id: debtId, userId, accountId: accountRef(accountId) };
    }),
    debtItems,
    budgets: data.budgets.map(({ id, ...budget }) => ({ ...budget, id: newId(id), userId })),
    // FIN-113 — `investmentId` refeito pelo mapa (accountId já era); `id: investmentIds.get(id)`
    // abaixo, e não outro `newId(id)`, é o que faz o vínculo apontar para o MESMO id novo do
    // investimento — dois `newId(id)` para a mesma origem gerariam dois uuids diferentes.
    goals: data.goals.map(({ id, accountId, investmentId, ...goal }) => ({
      currentAmount: 0, ...goal, id: newId(id), userId, accountId: accountRef(accountId), investmentId: investmentRef(investmentId),
    })),
    recurring: data.recurring.map(({ id, accountId, ...rec }) => ({
      active: true, ...rec, id: newId(id), userId, accountId: accountRef(accountId),
    })),
    investments: data.investments.map(({ id, accountId, ...investment }) => ({
      ...investment, id: investmentIds.get(id), userId, accountId: accountRef(accountId), currency: investment.currency ?? BASE_CURRENCY,
    })),
    categoryRules: data.categoryRules.map(({ id, ...rule }) => ({ ...rule, id: newId(id), userId })),
  };
}

// Corpo JSON próprio, com limite maior — ver a nota sobre `isBackupImportPath` em server.js: o
// parser global (100 kB) pula esta rota porque o arquivo inteiro de backup não cabe nele.
const backupImportJsonBody = express.json({ limit: BACKUP_BODY_LIMIT });

// Restauração: SUBSTITUI todos os dados do usuário pelos do arquivo, numa única transação de banco
// — ou tudo é trocado, ou nada muda. Por ser destrutiva, pede a senha, e o arquivo inteiro é
// validado antes de qualquer exclusão. O corpo só é lido depois da autenticação, com limite
// próprio (o parser global pula esta rota — ver `isBackupImportPath`).
router.post('/import', authLimiter, authenticateToken, backupImportJsonBody, async (req, res) => {
  const userId = req.user.userId;
  const { password, backup } = req.body ?? {};
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Confirme a restauração com a sua senha.' });
  }
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
    return res.status(400).json({ error: 'Envie o conteúdo do arquivo de backup.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (!(await bcrypt.compare(password, user.passwordHash))) return res.status(400).json({ error: 'Senha incorreta.' });

    const parsed = backupSchema.safeParse(backup);
    if (!parsed.success) return res.status(400).json({ error: backupIssueMessage(parsed.error.issues) });
    const data = parsed.data.data;
    const inconsistency = backupConsistencyError(data);
    if (inconsistency) return res.status(400).json({ error: `Backup inválido: ${inconsistency}` });

    const rows = buildRestoreRows(userId, data, !(await backupIdsTakenByOthers(userId, data)));
    await prisma.$transaction([
      // Filhos antes dos pais, por causa das chaves estrangeiras.
      prisma.debtItem.deleteMany({ where: { debt: { userId } } }),
      prisma.debt.deleteMany({ where: { userId } }),
      prisma.transaction.deleteMany({ where: { userId } }),
      prisma.recurringTransaction.deleteMany({ where: { userId } }),
      prisma.investment.deleteMany({ where: { userId } }),
      prisma.budget.deleteMany({ where: { userId } }),
      prisma.goal.deleteMany({ where: { userId } }),
      prisma.categoryRule.deleteMany({ where: { userId } }),
      // Avisos derivados dos dados antigos; os dos restaurados são gerados na próxima carga do app.
      prisma.notification.deleteMany({ where: { userId } }),
      prisma.account.deleteMany({ where: { userId } }),
      prisma.account.createMany({ data: rows.accounts }),
      // FIN-113: investimentos antes de metas — uma meta pode apontar para um (`investmentId`), e
      // a chave estrangeira exige que ele já exista na hora de inserir a meta.
      prisma.investment.createMany({ data: rows.investments }),
      prisma.transaction.createMany({ data: rows.transactions }),
      prisma.debt.createMany({ data: rows.debts }),
      prisma.debtItem.createMany({ data: rows.debtItems }),
      prisma.budget.createMany({ data: rows.budgets }),
      prisma.goal.createMany({ data: rows.goals }),
      prisma.recurringTransaction.createMany({ data: rows.recurring }),
      prisma.categoryRule.createMany({ data: rows.categoryRules }),
    ]);

    const restored = Object.fromEntries(Object.keys(BACKUP_SECTIONS).map(section => [section, data[section].length]));
    res.json({ success: true, restored });
  } catch (err) {
    sendInternalError(res, err, 'Erro ao restaurar o backup. Nenhum dado foi alterado.');
  }
});
