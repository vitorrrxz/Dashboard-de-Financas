import './env.js';
import { PluggyClient } from 'pluggy-sdk';
import { BASE_CURRENCY, CURRENCY_CODE_PATTERN, toCents } from './money.js';
import { ruleCategory } from './categorization.js';

// Pluggy Client — inicialização preguiçosa (lazy). O construtor do SDK lança exceção
// síncrona ("Missing authorization for API communication") quando clientId/clientSecret
// estão vazios — como essas credenciais são opcionais (só necessárias para conectar
// bancos reais, ver .env.example), instanciar no topo do módulo derrubava o servidor
// inteiro no boot para quem não configurou Pluggy. Agora só é criado (e só falha) quando
// uma rota Pluggy é de fato chamada.
let pluggyClient = null;
export function getPluggyClient() {
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
export function mapPluggyAccountType(pluggyAcc) {
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
export function pluggyReauthMessage(status) {
  if (status === 'LOGIN_ERROR') {
    return 'A conexão com este banco expirou ou as credenciais mudaram. Reconecte o banco para continuar sincronizando.';
  }
  if (status === 'OUTDATED') {
    return 'A última tentativa de sincronização deste banco falhou. Tente novamente; se o problema persistir, reconecte o banco.';
  }
  return null;
}

// FIN-092 — Sinal das transações vindas da Pluggy.
//
// Em conta BANK a Pluggy já devolve o valor na convenção do app: negativo = saiu dinheiro,
// positivo = entrou. Em conta CREDIT o referencial é o da fatura, não o do bolso do
// usuário: uma COMPRA aumenta a fatura e vem POSITIVA; o PAGAMENTO da fatura a reduz e vem
// NEGATIVO. Importar esse valor cru fazia toda compra no cartão — inclusive as parcelas já
// lançadas para meses futuros — ser contabilizada como receita.
//
// O discriminador é o tipo da CONTA, e não o campo `type` (DEBIT/CREDIT) da transação:
// `type` seria mais genérico, mas não foi possível confirmar sua polaridade nos conectores
// de cartão contra dados reais, e um engano ali inverteria também as contas correntes, que
// hoje estão corretas. O tipo da conta foi conferido contra o extrato real de um cartão.
export function pluggyAmountToCents(pluggyTx, accountType) {
  const cents = toCents(pluggyAmountInAccountCurrency(pluggyTx));
  // O teste de zero evita gravar -0: inofensivo em SQLite, mas confuso ao depurar.
  if (accountType !== 'credit' || cents === 0) return cents;
  return -cents;
}

// FIN-095 — Valor de uma compra em moeda estrangeira.
//
// Numa compra internacional no cartão, `amount` vem na moeda da COMPRA (dólares, por exemplo)
// e `amountInAccountCurrency` no valor que entra na fatura, na moeda da CONTA. Gravar
// `amount` registrava US$ 10 como R$ 10. O app guarda o valor na moeda da conta — é o que o
// usuário paga e o que soma com o resto do extrato. Do campo novo só se usa o módulo: o sinal
// continua vindo de `amount`, cuja convenção foi conferida contra dados reais em FIN-092.
export function pluggyAmountInAccountCurrency(pluggyTx) {
  const inAccount = pluggyTx.amountInAccountCurrency;
  if (typeof inAccount !== 'number' || !Number.isFinite(inAccount)) return pluggyTx.amount;
  const sign = pluggyTx.amount < 0 ? -1 : pluggyTx.amount > 0 ? 1 : Math.sign(inAccount);
  return sign * Math.abs(inAccount);
}

// Marcadores com que a Pluggy identifica o pagamento da própria fatura do cartão. A
// comparação é por inclusão e em minúsculas porque o texto varia entre conectores
// (categoria normalizada em inglês, descrição no idioma do banco).
const CREDIT_CARD_PAYMENT_MARKERS = ['credit card payment', 'pagamento de fatura', 'pagamento recebido'];

// FIN-103 — transferência entre contas próprias e pagamento de fatura: nem receita nem despesa,
// então também não geram alerta de gasto. Mesma lista de OWN_TRANSFER_CATEGORIES em
// src/utils/categories.ts — server.notifications.test.js confere as duas.
export const OWN_TRANSFER_CATEGORIES = ['Transferência entre contas', 'Pagamento de fatura', 'Credit card payment', 'Same person transfer', 'Transfer - Internal'];

// Um lançamento de cartão que é o pagamento da fatura, e não uma compra.
//
// Ele não é uma movimentação nova: o dinheiro já saiu da conta corrente (onde aparece como
// despesa) e as compras que compõem a fatura já foram contabilizadas uma a uma. Importá-lo
// somaria o mesmo valor duas vezes — e, com o sinal corrigido acima, ainda apareceria como
// RECEITA. A verificação só é aplicada em contas de cartão: numa conta corrente,
// "pagamento recebido" é uma entrada legítima.
export function isCreditCardBillPayment(pluggyTx) {
  const haystack = ((pluggyTx.category ?? '') + ' ' + (pluggyTx.description ?? '')).toLowerCase();
  return CREDIT_CARD_PAYMENT_MARKERS.some(marker => haystack.includes(marker));
}

// FIN-104 — categoria de uma transação nova vinda da Pluggy. O pagamento de fatura visto da conta
// corrente às vezes vem só como "Transfers"; pelo texto, vira "Pagamento de fatura", que fica fora
// de receitas e despesas (FIN-103). No cartão, esses lançamentos nem chegam aqui (FIN-092). Só na
// criação: numa nova sincronização, a categoria que o usuário escolheu fica. FIN-105: uma regra de
// categoria do usuário vem antes de tudo.
export function pluggyTransactionCategory(pluggyTx, rules = []) {
  return ruleCategory(rules, pluggyTx.description)
    ?? (pluggyTx.amount < 0 && isCreditCardBillPayment(pluggyTx) ? 'Pagamento de fatura' : (pluggyTx.category || 'Outros'));
}

// FIN-074 — moeda de uma conta vinda da Pluggy (`currencyCode`, ISO 4217). Código ausente ou
// fora do padrão cai em real — a moeda de todas as contas antes de FIN-074 —, porque um valor
// inválido gravado aqui impediria a conversão de todos os totais da conta. Um código válido
// fora da lista do app é gravado como veio: a tela mostra o código e avisa se faltar cotação.
export function pluggyCurrency(currencyCode) {
  return typeof currencyCode === 'string' && CURRENCY_CODE_PATTERN.test(currencyCode) ? currencyCode : BASE_CURRENCY;
}

/**
 * Dia de vencimento (1–31) de uma fatura da Pluggy, ou `undefined` se a data não vier ou for
 * inválida. As datas de fatura chegam como meia-noite UTC: ler o dia em UTC evita que o fuso
 * do Brasil (UTC-3) o desloque para o dia anterior.
 */
export function pluggyBillDueDay(bill) {
  if (!bill?.dueDate) return undefined;
  const date = new Date(bill.dueDate);
  return Number.isNaN(date.getTime()) ? undefined : date.getUTCDate();
}
