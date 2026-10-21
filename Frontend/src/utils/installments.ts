// FIN-094 — compras parceladas no cartão e visão mensal de vencimentos (aba Dívidas).
//
// Uma compra parcelada chega do cartão como N transações independentes, uma por parcela,
// cada uma com o sufixo "n/N" no nome ("Mercado*Mercadolivre 3/10"). Este módulo reconhece
// essas parcelas, reagrupa-as na compra de origem e monta o cronograma mês a mês, junto com
// as parcelas das dívidas cadastradas à mão.
//
// O reconhecimento é pelo nome, e não pelo `creditCardMetadata` da Pluggy, porque o sufixo
// "n/N" é o padrão dos extratos de cartão brasileiros e aparece igual nas duas origens de
// dados do app: a sincronização via Pluggy e a importação manual de OFX/CSV, que não tem
// metadado nenhum. Todos os valores estão em REAIS.

import type { Debt, Transaction } from '../types';
import { dateInMonth, monthsDescending, shiftMonth } from './dates';
import { remainingDebtSchedule } from './debts';

/**
 * Sufixo de parcela no fim do nome: "Loja 3/10", "Loja 03/10", "Loja PARC 3/10",
 * "Loja - Parcela 3/10". Exige um espaço (ou a palavra "parc"/"parcela") antes do número,
 * para não ler como parcela um código colado ao nome.
 */
const INSTALLMENT_SUFFIX = /^(.*?)(?:\s+|[\s\-–]*parc(?:ela)?\.?\s*)(\d{1,2})\s*\/\s*(\d{1,2})\s*$/i;

/** Separadores soltos que sobram no fim do nome-base ("Loja -" → "Loja"). */
const TRAILING_SEPARATORS = /[\s\-–]+$/;

export interface InstallmentInfo {
  /** Nome da compra sem o sufixo de parcela (pode ser vazio: "PARC 03/10"). */
  baseName: string;
  /** Número desta parcela (1 = primeira). */
  number: number;
  /** Quantidade total de parcelas da compra. */
  total: number;
}

/**
 * Lê o sufixo de parcela do nome de uma transação. Devolve `null` quando não há sufixo ou
 * quando ele não descreve um parcelamento: "12/05" (parcela maior que o total — em geral
 * uma data no fim da descrição), "1/1" (à vista) e "0/3".
 */
export function parseInstallment(name: string): InstallmentInfo | null {
  const match = INSTALLMENT_SUFFIX.exec(name);
  if (!match) return null;
  const number = Number(match[2]);
  const total = Number(match[3]);
  if (total < 2 || number < 1 || number > total) return null;
  return { baseName: match[1].replace(TRAILING_SEPARATORS, '').trim(), number, total };
}

/** Sufixo de parcela de uma COMPRA NO CARTÃO; `null` para qualquer outra transação. */
function cardInstallmentInfo(t: Pick<Transaction, 'name' | 'amount' | 'paymentType'>): InstallmentInfo | null {
  if (t.paymentType !== 'credit' || t.amount >= 0) return null;
  return parseInstallment(t.name);
}

/**
 * Se a transação é um lançamento parcelado — e, portanto, pertence à aba Dívidas, não à de
 * Transações:
 * - parcela de compra no cartão (`paymentType: 'credit'` com sufixo "n/N");
 * - lançamento importado como PIX parcelado, que a importação já converte em dívida (ver
 *   `handleImport` em App.tsx).
 *
 * Só saídas contam. Um estorno com sufixo de parcela é dinheiro voltando e continua sendo
 * uma transação comum — mesma regra da importação, que monta a dívida só com as despesas.
 * Numa conta corrente o sufixo sozinho não basta: ali "n/N" no fim do nome pode ser
 * qualquer coisa.
 */
export function isInstallmentTransaction(t: Pick<Transaction, 'name' | 'amount' | 'paymentType'>): boolean {
  if (t.amount < 0 && t.paymentType === 'pix_installment') return true;
  return cardInstallmentInfo(t) !== null;
}

/** Uma parcela de uma compra parcelada no cartão. */
export interface CardInstallment {
  number: number;
  /** Data da parcela (ISO YYYY-MM-DD). */
  date: string;
  /** Valor da parcela, positivo. */
  amount: number;
  /**
   * A parcela não veio nos dados e foi deduzida — tipicamente as anteriores à janela da
   * sincronização, ou uma lacuna. Data = mês de início + (n − 1), no mesmo dia da parcela
   * mais recente; valor = o da parcela mais recente.
   */
  estimated: boolean;
}

export interface InstallmentPurchase {
  /** Identificador estável do agrupamento, usado como `key` na lista. */
  key: string;
  name: string;
  category: string;
  accountId?: string;
  totalInstallments: number;
  /** Valor de referência da parcela: o da parcela mais recente. */
  installmentAmount: number;
  /** Soma de todas as parcelas, reais e estimadas. */
  totalAmount: number;
  /** Parcelas com data até hoje — já lançadas em alguma fatura. */
  chargedInstallments: number;
  chargedAmount: number;
  /** Soma das parcelas ainda por lançar. */
  remainingAmount: number;
  /** Data da próxima parcela a lançar; `null` quando todas já foram lançadas. */
  nextDate: string | null;
  /** Parcelas de 1 a N, em ordem. */
  installments: CardInstallment[];
}

interface ParsedRow {
  transaction: Transaction;
  info: InstallmentInfo;
}

/** Arredonda ao centavo — somar floats repetidamente acumula ruído (ver FIN-015). */
function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Mês (YYYY-MM) da primeira parcela, deduzido de uma parcela qualquer da compra. */
function purchaseStartMonth(row: ParsedRow): string {
  return shiftMonth(row.transaction.date.slice(0, 7), -(row.info.number - 1));
}

/**
 * Separa compras distintas que caíram na mesma chave de agrupamento — mesma loja, mesmo
 * número de parcelas, mesmo mês de início (duas compras parceladas iguais no mesmo mês). O
 * sinal disso é um número de parcela repetido. Como as parcelas de uma compra têm valor
 * constante, ordenar as repetidas por valor mantém cada compra no mesmo "trilho" mês a mês.
 * É uma heurística: sem o metadado da operadora não há como distinguir duas compras de
 * valor idêntico — e, nesse caso, qualquer divisão resulta nos mesmos totais.
 */
function splitIdenticalPurchases(rows: ParsedRow[]): ParsedRow[][] {
  const byNumber = new Map<number, ParsedRow[]>();
  for (const row of rows) {
    const list = byNumber.get(row.info.number) ?? [];
    list.push(row);
    byNumber.set(row.info.number, list);
  }
  const copies = Math.max(...Array.from(byNumber.values(), list => list.length));
  if (copies === 1) return [rows];

  const purchases: ParsedRow[][] = Array.from({ length: copies }, () => []);
  for (const sameNumber of byNumber.values()) {
    // Valores são negativos: o mais negativo (a maior compra) fica sempre no primeiro trilho.
    [...sameNumber]
      .sort((a, b) => a.transaction.amount - b.transaction.amount)
      .forEach((row, i) => purchases[i].push(row));
  }
  return purchases;
}

/** Monta uma compra a partir das suas parcelas, deduzindo as que não vieram nos dados. */
function buildPurchase(key: string, rows: ParsedRow[], today: string): InstallmentPurchase {
  const byNumber = new Map(rows.map(row => [row.info.number, row]));
  const latest = rows.reduce((a, b) => (b.info.number > a.info.number ? b : a));
  const startMonth = purchaseStartMonth(latest);
  const referenceDay = Number(latest.transaction.date.slice(8, 10));
  const referenceAmount = Math.abs(latest.transaction.amount);

  const installments: CardInstallment[] = [];
  for (let number = 1; number <= latest.info.total; number++) {
    const row = byNumber.get(number);
    installments.push(row
      ? { number, date: row.transaction.date, amount: Math.abs(row.transaction.amount), estimated: false }
      : { number, date: dateInMonth(shiftMonth(startMonth, number - 1), referenceDay), amount: referenceAmount, estimated: true });
  }

  const charged = installments.filter(i => i.date <= today);
  const totalAmount = roundCents(installments.reduce((s, i) => s + i.amount, 0));
  const chargedAmount = roundCents(charged.reduce((s, i) => s + i.amount, 0));

  return {
    key,
    name: latest.info.baseName || 'Compra parcelada',
    category: latest.transaction.category,
    accountId: latest.transaction.accountId,
    totalInstallments: latest.info.total,
    installmentAmount: referenceAmount,
    totalAmount,
    chargedInstallments: charged.length,
    chargedAmount,
    remainingAmount: roundCents(totalAmount - chargedAmount),
    nextDate: installments.find(i => i.date > today)?.date ?? null,
    installments,
  };
}

/**
 * Reagrupa as parcelas de cartão nas compras de origem.
 *
 * A chave de agrupamento é conta + nome-base + total de parcelas + mês da primeira parcela.
 * O mês de início (deduzido de cada parcela: mês dela − (n − 1)) é o que separa duas
 * compras na mesma loja com o mesmo número de parcelas feitas em meses diferentes. O valor
 * NÃO entra na chave, porque a primeira parcela costuma carregar o arredondamento da divisão
 * (R$ 147,93 contra R$ 147,89 nas demais, no extrato real que motivou FIN-094).
 *
 * `today` define o que já foi lançado: uma parcela com data até hoje já está em alguma
 * fatura. Compras em andamento vêm primeiro, pela próxima parcela; as concluídas, por último.
 */
export function groupInstallmentPurchases(transactions: Transaction[], today: string): InstallmentPurchase[] {
  const groups = new Map<string, ParsedRow[]>();
  for (const transaction of transactions) {
    const info = cardInstallmentInfo(transaction);
    if (!info) continue;
    const row: ParsedRow = { transaction, info };
    const key = [
      transaction.accountId ?? '',
      info.baseName.toLowerCase().replace(/\s+/g, ' '),
      info.total,
      purchaseStartMonth(row),
    ].join('|');
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const purchases: InstallmentPurchase[] = [];
  for (const [key, rows] of groups) {
    const split = splitIdenticalPurchases(rows);
    split.forEach((subRows, i) => purchases.push(buildPurchase(split.length > 1 ? `${key}#${i}` : key, subRows, today)));
  }

  return purchases.sort((a, b) => {
    if (a.nextDate && b.nextDate) return a.nextDate.localeCompare(b.nextDate) || a.name.localeCompare(b.name);
    if (a.nextDate) return -1;
    if (b.nextDate) return 1;
    const lastA = a.installments[a.installments.length - 1].date;
    const lastB = b.installments[b.installments.length - 1].date;
    return lastB.localeCompare(lastA) || a.name.localeCompare(b.name);
  });
}

/** Uma parcela que vence no mês de referência — de compra no cartão ou de dívida cadastrada. */
export interface DueItem {
  key: string;
  source: 'card' | 'debt';
  name: string;
  number: number;
  totalInstallments: number;
  date: string;
  amount: number;
  /** Só parcelas de cartão podem ser estimadas (ver `CardInstallment.estimated`). */
  estimated: boolean;
}

/**
 * Parcelas que caem no mês de referência (YYYY-MM): as das compras parceladas no cartão e as
 * das dívidas cadastradas. Das dívidas entram só as parcelas ainda não pagas — o cadastro
 * guarda o total pago, não o histórico de cada pagamento, então as parcelas já quitadas não
 * têm data para aparecer num mês passado.
 */
export function dueItemsInMonth(purchases: InstallmentPurchase[], debts: Debt[], month: string): DueItem[] {
  const items: DueItem[] = [];
  for (const purchase of purchases) {
    for (const installment of purchase.installments) {
      if (installment.date.slice(0, 7) !== month) continue;
      items.push({
        key: `card:${purchase.key}:${installment.number}`,
        source: 'card',
        name: purchase.name,
        number: installment.number,
        totalInstallments: purchase.totalInstallments,
        date: installment.date,
        amount: installment.amount,
        estimated: installment.estimated,
      });
    }
  }
  for (const debt of debts) {
    for (const installment of remainingDebtSchedule(debt)) {
      if (installment.dueDate.slice(0, 7) !== month) continue;
      items.push({
        key: `debt:${debt.id}:${installment.number}`,
        source: 'debt',
        name: debt.name,
        number: installment.number,
        totalInstallments: debt.totalInstallments,
        date: installment.dueDate,
        amount: installment.amount,
        estimated: false,
      });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

export interface DueTotals {
  /** Soma das parcelas de cartão do mês. */
  card: number;
  /** Soma das parcelas de dívidas cadastradas do mês. */
  debt: number;
  /** `card + debt` — o valor total a pagar no mês de referência. */
  total: number;
  count: number;
}

/** Soma as parcelas do mês, separando cartão de dívida cadastrada. */
export function summarizeDueItems(items: DueItem[]): DueTotals {
  let card = 0;
  let debt = 0;
  for (const item of items) {
    if (item.source === 'card') card += item.amount;
    else debt += item.amount;
  }
  return { card: roundCents(card), debt: roundCents(debt), total: roundCents(card + debt), count: items.length };
}

/**
 * Meses com alguma parcela (de cartão ou de dívida), do mais recente para o mais antigo,
 * sempre incluindo `alwaysInclude` (o mês corrente).
 */
export function dueMonths(purchases: InstallmentPurchase[], debts: Debt[], alwaysInclude?: string): string[] {
  const dates = [
    ...purchases.flatMap(p => p.installments.map(i => i.date)),
    ...debts.flatMap(d => remainingDebtSchedule(d).map(i => i.dueDate)),
  ];
  return monthsDescending(dates, alwaysInclude);
}
