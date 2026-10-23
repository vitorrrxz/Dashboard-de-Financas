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
// Dividir pagamento: uma parte da parcela do mês, paga no seu dia. Ver `DebtSplit` no schema.
export const debtSplitSchema = z.object({
  day: z.coerce.number().int().min(1, 'Dia da parte entre 1 e 31.').max(31, 'Dia da parte entre 1 e 31.'),
  amount: z.coerce.number().int('Valor da parte deve ser um inteiro em centavos.').min(1, 'Cada parte precisa de um valor maior que zero.'),
});
// Lista vazia desfaz a divisão; uma parte só não divide nada.
const debtSplitsField = z.array(debtSplitSchema).max(10, 'Divida o pagamento em no máximo 10 partes.')
  .refine(splits => splits.length !== 1, 'Divida o pagamento em pelo menos 2 partes.');
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
  splits: debtSplitsField.optional(),
});
// FIN-125 — toda dívida nova nasce ligada a uma conta. Só na rota: o backup continua aceitando
// dívidas sem conta (as antigas, e as de uma conta excluída, que o banco desvincula).
const DEBT_ACCOUNT_REQUIRED = 'Selecione a conta vinculada à dívida.';
const debtAccountField = z.string({ error: DEBT_ACCOUNT_REQUIRED }).trim().min(1, DEBT_ACCOUNT_REQUIRED);
export const debtCreateSchema = debtSchema.extend({ accountId: debtAccountField });
// Editar pode trocar a conta, mas não desvincular; sem `accountId`, a dívida fica como está.
export const debtUpdateSchema = debtSchema.extend({ accountId: debtAccountField.optional() }).partial();

// FIN-042/FIN-043 — orçamento mensal por categoria (Fase 3). `category` é texto livre
// (não um enum fechado, ao contrário de `debtSchema.category`) porque precisa casar com a
// categoria de qualquer transação — inclusive categorias digitadas manualmente pelo
// usuário na importação, que não pertencem a uma lista fixa (ver `CATEGORIES` em
// App.tsx e `CATEGORY_RULES` em parsers.ts). `monthlyLimit` exige > 0: um orçamento de
// R$0 não tem sentido de negócio e, sem essa validação, `computeBudgetProgress`
// (src/utils/budget.ts) precisaria tratar divisão por zero.
export const budgetSchema = z.object({
  category: z.string({ error: 'Categoria é obrigatória.' }).trim().min(1, 'Categoria é obrigatória.'),
  monthlyLimit: z.coerce.number().int('Limite mensal deve ser um inteiro em centavos.').min(1, 'Limite mensal deve ser maior que zero.'),
});
export const budgetUpdateSchema = budgetSchema.partial();
// Salário manual: valor de cada pagamento (centavos) e periodicidade.
export const salarySchema = z.object({
  salaryCents: z.coerce.number().int('Salário deve ser um inteiro em centavos.').min(0, 'Salário não pode ser negativo.'),
  salaryFrequency: z.enum(['monthly', 'biweekly'], { message: 'Periodicidade deve ser mensal ou quinzenal.' }),
  // Quinzenal: valor do 2º pagamento (`salaryCents` é o do 1º). Opcional para quem só manda um valor.
  salarySecondCents: z.coerce.number().int('Salário deve ser um inteiro em centavos.').min(0, 'Salário não pode ser negativo.').optional(),
  // Quinzenal: dia do 1º pagamento; o 2º é 15 dias depois. Opcional para quem só manda valor e periodicidade.
  salaryPayDay: z.coerce.number().int().min(1, 'Dia de pagamento entre 1 e 15.').max(15, 'Dia de pagamento entre 1 e 15.').optional(),
  // Receitas extras previstas (PLR, 13º...): substitui a lista inteira. Opcional para quem só manda o salário.
  extraIncomes: z.array(z.object({
    name: z.string().trim().min(1, 'Informe o nome da receita extra.').max(60, 'Nome da receita extra com até 60 caracteres.'),
    amountCents: z.coerce.number().int('Receita extra deve ser um inteiro em centavos.').positive('Receita extra deve ser maior que zero.'),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês da receita extra deve ser AAAA-MM.'),
    // Quinzena em que entra (só importa no quinzenal).
    half: z.union([z.literal(1), z.literal(2)], { message: 'Quinzena da receita extra deve ser 1 ou 2.' }),
    // Repete todo ano no mesmo mês (13º, PLR); falso = só uma vez.
    yearly: z.boolean(),
  })).max(50, 'No máximo 50 receitas extras.').optional(),
});
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
  debtId: accountIdField, // mesmo formato de id opcional ("" = sem vínculo)
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
