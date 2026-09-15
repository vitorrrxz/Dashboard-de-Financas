import { z } from 'zod';
import { currencyField } from './money.js';

// Campos monetários trafegam em CENTAVOS (inteiro) entre API e frontend — ver FIN-015
// em docs/BACKLOG_DETAIL.md. `interestRate` é a única exceção: é uma taxa percentual
// (% ao mês), não um valor monetário, e permanece decimal.

export const ACCOUNT_TYPES = ['checking', 'savings', 'credit', 'investment', 'cash'];
export const accountSchema = z.object({
  name: z.string({ error: 'Nome da conta é obrigatório.' }).trim().min(1, 'Nome da conta é obrigatório.'),
  bank: z.string({ error: 'Banco/operadora é obrigatório.' }).trim().min(1, 'Banco/operadora é obrigatório.'),
  type: z.enum(ACCOUNT_TYPES, { message: `Tipo de conta deve ser um de: ${ACCOUNT_TYPES.join(', ')}.` }),
  balance: z.coerce.number().int('Saldo deve ser um valor inteiro em centavos.'),
  limit: z.coerce.number().int('Limite deve ser um valor inteiro em centavos.').nullable().optional(),
  dueDay: z.coerce.number().int().min(1).max(31).nullable().optional(),
  closingDay: z.coerce.number().int().min(1).max(31).nullable().optional(),
  pendingBill: z.coerce.number().int('Fatura deve ser um valor inteiro em centavos.').nullable().optional(),
  currency: currencyField, // FIN-074 — ausente no cadastro = real (padrão do banco)
  color: z.string({ error: 'Cor é obrigatória.' }).trim().min(1, 'Cor é obrigatória.'),
});
export const accountUpdateSchema = accountSchema.partial();

// Aceita `accountId: ''` (usado pelo frontend para "sem conta vinculada") como sinônimo
// de `null` — sem isso, `z.string().min(1)` rejeitava string vazia com um erro de
// validação antes mesmo do handler rodar, tornando inalcançável a normalização que a
// rota PUT /api/debts/:id fazia depois (ver correção abaixo).
export const accountIdField = z.preprocess(
  v => (v === '' ? null : v),
  z.string().trim().min(1).nullable().optional()
);

export const PAYMENT_TYPES = ['debit', 'credit', 'pix', 'pix_installment'];
export const transactionSchema = z.object({
  name: z.string({ error: 'Nome da transação é obrigatório.' }).trim().min(1, 'Nome da transação é obrigatório.'),
  category: z.string({ error: 'Categoria é obrigatória.' }).trim().min(1, 'Categoria é obrigatória.'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD.'),
  amount: z.coerce.number().int('Valor deve ser um inteiro em centavos.'),
  accountId: accountIdField,
  paymentType: z.enum(PAYMENT_TYPES).optional(),
  externalId: z.string().trim().min(1).optional(), // FITID do OFX — ver computeImportHash
  // Sem `currency`: a moeda de uma transação é sempre a da conta, derivada pelo servidor
  // (FIN-074). Um `currency` enviado pelo cliente é descartado pelo Zod, como todo campo extra.
});
export const transactionBatchSchema = z.object({
  transactions: z.array(transactionSchema).min(1, 'Nenhuma transação enviada.'),
});
export const transactionUpdateSchema = transactionSchema.partial();

export const DEBT_CATEGORIES = ['Empréstimo', 'Financiamento', 'Cartão de Crédito', 'Pessoal', 'Outros'];
export const debtItemSchema = z.object({
  name: z.string().trim().min(1),
  amount: z.coerce.number().int(),
  date: z.string().trim().min(1),
});
export const debtSchema = z.object({
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
export const debtUpdateSchema = debtSchema.partial();

// FIN-042/FIN-043 — orçamento mensal por categoria (Fase 3). `category` é texto livre
// (não um enum fechado, ao contrário de `debtSchema.category`) porque precisa casar com a
// categoria de qualquer transação — inclusive categorias digitadas manualmente pelo
// usuário na importação, que não pertencem a uma lista fixa (ver `CATEGORY_COLORS` em
// App.tsx e `CATEGORY_RULES` em parsers.ts). `monthlyLimit` exige > 0: um orçamento de
// R$0 não tem sentido de negócio e, sem essa validação, `computeBudgetProgress`
// (src/utils/budget.ts) precisaria tratar divisão por zero.
export const budgetSchema = z.object({
  category: z.string({ error: 'Categoria é obrigatória.' }).trim().min(1, 'Categoria é obrigatória.'),
  monthlyLimit: z.coerce.number().int('Limite mensal deve ser um inteiro em centavos.').min(1, 'Limite mensal deve ser maior que zero.'),
});
export const budgetUpdateSchema = budgetSchema.partial();
// FIN-105 — regra de categoria. Pelo menos 2 caracteres: uma letra só casaria com quase toda descrição.
export const categoryRuleSchema = z.object({
  match: z.string({ error: 'Texto da regra é obrigatório.' }).trim().min(2, 'O texto da regra precisa de ao menos 2 caracteres.').max(100),
  category: z.string({ error: 'Categoria é obrigatória.' }).trim().min(1, 'Categoria é obrigatória.').max(100),
});
// FIN-106 — só na rota: `applyToExisting` não é campo da regra (nem do backup).
export const categoryRuleRequestSchema = categoryRuleSchema.extend({ applyToExisting: z.boolean().optional() });
// FIN-049/FIN-050 — metas financeiras (Fase 4). `targetAmount` exige > 0: uma meta de R$0
// não tem sentido de negócio e tornaria o cálculo de progresso uma divisão por zero.
// `currentAmount` é opcional no create (nasce em 0) para que o mesmo schema sirva de base
// ao `partial()` usado no update — mesmo padrão de `paidAmount` em `debtSchema`.
// FIN-113 — `accountId`/`investmentId` (nunca os dois) ligam a meta a uma conta ou a um
// investimento: o cliente passa a manter `currentAmount` em dia sozinho, e a checagem de posse
// (não pode ser conta de outro usuário, nem cartão de crédito) fica na rota, que também garante a
// exclusividade — checar isso aqui, com `.refine()`, impediria `.extend()` no schema do backup e
// `.partial()` no do update (nenhum dos dois existe em cima de um `ZodEffects`).
export const goalSchema = z.object({
  name: z.string({ error: 'Nome da meta é obrigatório.' }).trim().min(1, 'Nome da meta é obrigatório.'),
  targetAmount: z.coerce.number().int('Valor da meta deve ser um inteiro em centavos.').min(1, 'Valor da meta deve ser maior que zero.'),
  currentAmount: z.coerce.number().int('Valor acumulado deve ser um inteiro em centavos.').min(0, 'Valor acumulado não pode ser negativo.').optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data-alvo deve estar no formato YYYY-MM-DD.'),
  accountId: accountIdField,
  investmentId: accountIdField, // mesmo formato de id opcional; o nome do campo é que muda
});
export const goalUpdateSchema = goalSchema.partial();

// FIN-053/FIN-054 — transações recorrentes (Fase 4). `amount` segue a convenção de
// `Transaction`: negativo = despesa, positivo = receita — e não pode ser 0, que geraria
// lançamentos sem efeito nenhum a cada ocorrência.
export const RECURRENCE_FREQUENCIES = ['weekly', 'monthly', 'yearly'];
export const recurringSchema = z.object({
  name: z.string({ error: 'Nome da recorrência é obrigatório.' }).trim().min(1, 'Nome da recorrência é obrigatório.'),
  category: z.string({ error: 'Categoria é obrigatória.' }).trim().min(1, 'Categoria é obrigatória.'),
  amount: z.coerce.number().int('Valor deve ser um inteiro em centavos.').refine(v => v !== 0, 'Valor não pode ser zero.'),
  frequency: z.enum(RECURRENCE_FREQUENCIES, { message: `Frequência deve ser uma de: ${RECURRENCE_FREQUENCIES.join(', ')}.` }),
  nextOccurrence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Próxima ocorrência deve estar no formato YYYY-MM-DD.'),
  accountId: accountIdField,
  active: z.boolean().optional(),
});
export const recurringUpdateSchema = recurringSchema.partial();

// FIN-070/FIN-071 — carteira de investimentos (Fase 7). Os dois valores aceitam 0: uma posição
// recebida sem custo (bonificação em ações, cripto de presente) não tem valor aplicado, e uma
// que perdeu tudo vale 0 — são estados reais, não erro de digitação. Negativo não existe.
// O vínculo com a conta é conferido na rota (`investmentAccountError`), porque depende do banco.
export const INVESTMENT_TYPES = ['fixed_income', 'stocks', 'funds', 'crypto', 'other'];
export const investmentSchema = z.object({
  name: z.string({ error: 'Nome do investimento é obrigatório.' }).trim().min(1, 'Nome do investimento é obrigatório.'),
  type: z.enum(INVESTMENT_TYPES, { message: `Tipo de investimento deve ser um de: ${INVESTMENT_TYPES.join(', ')}.` }),
  amountInvested: z.coerce.number().int('Valor aplicado deve ser um inteiro em centavos.').min(0, 'Valor aplicado não pode ser negativo.'),
  currentValue: z.coerce.number().int('Valor atual deve ser um inteiro em centavos.').min(0, 'Valor atual não pode ser negativo.'),
  accountId: accountIdField,
  currency: currencyField, // FIN-074 — ausente no cadastro = real (padrão do banco)
});
export const investmentUpdateSchema = investmentSchema.partial();

// FIN-112 — retrato mensal do patrimônio líquido. O cliente já calculou tudo (mesma lógica de
// `computeNetWorth`, em reais, convertida para centavos aqui) — a rota só valida e guarda; `total`
// tem que bater com `liquid + investments - liabilities`, senão o retrato não corresponde ao que
// `computeNetWorth` produziria e o gráfico mostraria um número que não existe em nenhuma tela.
export const netWorthSnapshotSchema = z.object({
  liquid: z.coerce.number().int('Saldo em contas deve ser um inteiro em centavos.'),
  investments: z.coerce.number().int('Investimentos devem ser um inteiro em centavos.').min(0, 'Investimentos não pode ser negativo.'),
  liabilities: z.coerce.number().int('Passivos devem ser um inteiro em centavos.').min(0, 'Passivos não pode ser negativo.'),
  total: z.coerce.number().int('Patrimônio líquido deve ser um inteiro em centavos.'),
}).refine(d => d.total === d.liquid + d.investments - d.liabilities, {
  message: 'Patrimônio líquido não corresponde a contas + investimentos − passivos.',
});
