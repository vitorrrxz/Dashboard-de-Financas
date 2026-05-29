import type { Debt, DebtCategory } from '../types';

export interface Transaction {
  id: string;
  name: string;
  category: string;
  date: string;
  amount: number;
}

const CATEGORY_RULES: { keywords: string[]; category: string }[] = [
  { keywords: ['supermercado', 'mercado', 'padaria', 'restaurante', 'ifood', 'rappi', 'mcdonalds', 'burger', 'subway', 'lanchonete', 'pizzaria', 'açougue', 'hortifruti', 'carrefour', 'pao de acucar', 'extra', 'atacadao', 'assai'], category: 'Alimentação' },
  { keywords: ['uber', '99taxi', '99app', 'taxi', 'shell', 'ipiranga', 'posto', 'combustivel', 'gasolina', 'etanol', 'pedágio', 'estacionamento', 'onibus', 'metro', 'passagem'], category: 'Transporte' },
  { keywords: ['netflix', 'spotify', 'steam', 'cinema', 'ingresso', 'teatro', 'show', 'disney', 'hbo', 'amazon prime', 'youtube', 'twitch', 'game', 'playstation', 'xbox'], category: 'Lazer' },
  { keywords: ['aluguel', 'condominio', 'iptu', 'agua', 'energia', 'luz', 'gas', 'internet', 'telefone', 'celular', 'claro', 'vivo', 'tim', 'oi', 'net', 'comgas'], category: 'Moradia' },
  { keywords: ['farmacia', 'drogaria', 'hospital', 'clinica', 'medico', 'dentista', 'plano de saude', 'unimed', 'amil', 'remedios', 'exame'], category: 'Saúde' },
  { keywords: ['salario', 'pagamento', 'transferencia recebida', 'pix recebido', 'credito em conta', 'rendimento', 'dividendo', 'freelance', 'honorarios'], category: 'Receita' },
  { keywords: ['faculdade', 'escola', 'curso', 'mensalidade', 'livro', 'material escolar', 'udemy', 'coursera', 'alura'], category: 'Educação' },
  { keywords: ['shopping', 'roupa', 'calçado', 'loja', 'magazine', 'americanas', 'amazon', 'mercado livre', 'ali express', 'zara', 'renner', 'c&a'], category: 'Compras' },
];

function autoCategory(description: string): string {
  const lower = description.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some(k => lower.includes(k))) {
      return rule.category;
    }
  }
  return 'Outros';
}

/**
 * Parses a monetary value string handling both BR and US formats:
 * - BR: 1.500,00  or  150,00  (comma = decimal)
 * - US: 1500.00   or  150.00  (dot = decimal)
 */
function parseAmount(raw: string): number {
  const s = raw.trim().replace(/["'\s]/g, '').replace(/^R\$\s*/, '');
  if (!s || s === '-' || s === '+') return NaN;

  const hasDot   = s.includes('.');
  const hasComma = s.includes(',');

  if (hasDot && hasComma) {
    // e.g. 1.500,00 → BR format: dot = thousands, comma = decimal
    if (s.lastIndexOf('.') < s.lastIndexOf(',')) {
      return parseFloat(s.replace(/\./g, '').replace(',', '.'));
    }
    // e.g. 1,500.00 → US format: comma = thousands, dot = decimal
    return parseFloat(s.replace(/,/g, ''));
  }
  if (hasComma && !hasDot) {
    // Comma only — check how many digits after comma
    const afterComma = s.split(',')[1] ?? '';
    // If 1 or 2 digits after comma → decimal separator (BR)
    if (afterComma.length <= 2) return parseFloat(s.replace(',', '.'));
    // Otherwise thousands separator → remove comma
    return parseFloat(s.replace(',', ''));
  }
  // Dot only or plain integer — just parse directly (US decimal or integer)
  return parseFloat(s);
}

function normalizeDate(rawDate: string): string {
  const clean = rawDate.trim().split(' ')[0]; // ignore time part if present

  // DD/MM/YYYY
  const brMatch = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brMatch) {
    const day = brMatch[1].padStart(2, '0');
    const month = brMatch[2].padStart(2, '0');
    const year = brMatch[3];
    return `${year}-${month}-${day}`;
  }

  // YYYY-MM-DD
  const isoMatch = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const year = isoMatch[1];
    const month = isoMatch[2].padStart(2, '0');
    const day = isoMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // DD-MM-YYYY
  const dashMatch = clean.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dashMatch) {
    const day = dashMatch[1].padStart(2, '0');
    const month = dashMatch[2].padStart(2, '0');
    const year = dashMatch[3];
    return `${year}-${month}-${day}`;
  }

  // YYYY/MM/DD
  const slashMatch = clean.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const year = slashMatch[1];
    const month = slashMatch[2].padStart(2, '0');
    const day = slashMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return '';
}

function parseOFXDate(raw: string): string {
  if (!raw || raw.length < 8) return '';
  // OFX dates: 20231015120000[-3:BRT] or 20231015
  const clean = raw.replace(/\[.*\]/, '').trim();
  const year = clean.substring(0, 4);
  const month = clean.substring(4, 6);
  const day = clean.substring(6, 8);
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) {
    return '';
  }
  return `${year}-${month}-${day}`;
}

export function parseOFX(content: string): Transaction[] {
  const transactions: Transaction[] = [];

  // Handle both SGML (old) and XML OFX formats
  // Extract STMTTRN blocks
  const blockRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  const blocks = content.match(blockRegex);

  if (blocks && blocks.length > 0) {
    // XML-style OFX
    blocks.forEach((block, i) => {
      const get = (tag: string) => {
        const m = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'));
        return m ? m[1].trim() : '';
      };
      const amount = parseAmount(get('TRNAMT'));
      const memo = get('MEMO') || get('NAME') || 'Transação';
      const dateRaw = get('DTPOSTED');
      transactions.push({
        id: get('FITID') || `ofx-${i}-${Date.now()}`,
        name: memo,
        category: autoCategory(memo),
        date: parseOFXDate(dateRaw),
        amount,
      });
    });
  } else {
    // SGML-style OFX (flat key:value)
    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let current: Partial<Transaction> = {};
    let inTrn = false;

    for (const line of lines) {
      if (line === '<STMTTRN>') { inTrn = true; current = {}; continue; }
      if (line === '</STMTTRN>') {
        if (inTrn && current.amount !== undefined) {
          transactions.push(current as Transaction);
        }
        inTrn = false;
        continue;
      }
      if (!inTrn) continue;

      const colonIdx = line.indexOf('>');
      if (colonIdx === -1) continue;
      const tag = line.substring(1, colonIdx).toUpperCase();
      const val = line.substring(colonIdx + 1).trim();

      if (tag === 'TRNAMT') current.amount = parseAmount(val);
      if (tag === 'DTPOSTED') current.date = parseOFXDate(val);
      if (tag === 'MEMO' || tag === 'NAME') {
        current.name = val;
        current.category = autoCategory(val);
      }
      if (tag === 'FITID') current.id = val;
    }
  }

  return transactions.filter(t => !isNaN(t.amount) && t.date);
}

// Split CSV line respecting quoted fields
function splitLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let field = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (!inQuote && ch === sep) { result.push(field.trim()); field = ''; continue; }
    field += ch;
  }
  result.push(field.trim());
  return result;
}

export function parseCSV(content: string): Transaction[] {
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  // Detect separator: semicolon or comma
  const sep = lines[0].includes(';') ? ';' : ',';

  const header = splitLine(lines[0], sep).map(h => h.toLowerCase().trim());
  const transactions: Transaction[] = [];

  const findCol = (...keys: string[]) => {
    // 1. Try exact matches first
    for (const k of keys) {
      const idx = header.findIndex(h => h === k);
      if (idx !== -1) return idx;
    }
    // 2. Try substring match
    for (const k of keys) {
      const idx = header.findIndex(h => h.includes(k));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const dateCol   = findCol('data', 'date', 'dt');
  const descCol   = findCol('descrição', 'descricao', 'description', 'lançamento', 'lancamento', 'memo', 'estabelecimento', 'título', 'titulo');
  const amountCol = findCol('valor', 'amount', 'value', 'montante');

  if (dateCol === -1 || amountCol === -1) return [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i], sep);
    if (cols.length < 2) continue;

    const rawDate   = cols[dateCol]   ?? '';
    const rawAmount = cols[amountCol] ?? '';
    const desc      = descCol !== -1 ? cols[descCol] : 'Transação';

    const amount = parseAmount(rawAmount);
    if (isNaN(amount)) continue;

    const date = normalizeDate(rawDate);
    if (!date) continue;

    transactions.push({
      id: `csv-${i}-${Date.now()}`,
      name: desc || 'Transação',
      category: autoCategory(desc),
      date,
      amount,
    });
  }

  return transactions;
}

export function parseDebtsCSV(content: string): Debt[] {
  // Remove BOM if present
  const cleanContent = content.replace(/^\uFEFF/, '');
  const lines = cleanContent.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const sep = lines[0].includes(';') ? ';' : ',';
  const header = splitLine(lines[0], sep).map(h => h.toLowerCase().trim());
  const debts: Debt[] = [];

  const findCol = (...keys: string[]) => {
    // 1. Try exact matches first
    for (const k of keys) {
      const idx = header.findIndex(h => h === k);
      if (idx !== -1) return idx;
    }
    // 2. Try substring match
    for (const k of keys) {
      const idx = header.findIndex(h => h.includes(k));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  let nameCol           = findCol('nome', 'name', 'title', 'descrição', 'descricao', 'título', 'titulo', 'divida', 'dívida');
  const catCol          = findCol('categoria', 'category', 'tipo');
  let totalAmountCol    = findCol('valor total', 'total amount', 'amount', 'montante', 'valor', 'total');
  const paidAmountCol   = findCol('valor pago', 'paid amount', 'pago');
  const monthlyCol      = findCol('parcela mensal', 'monthly payment', 'valor da parcela', 'mensalidade', 'parcela');
  const totalInstCol    = findCol('total de parcelas', 'total installments', 'parcelas totais', 'nº parcelas');
  const paidInstCol     = findCol('parcelas pagas', 'paid installments', 'parcelas quitadas');
  const dueDateCol      = findCol('vencimento', 'due date', 'date', 'próximo vencimento', 'data');
  const interestCol     = findCol('juros', 'interest', 'taxa');

  // Fallback: if name not found, take first column
  if (nameCol === -1 && header.length > 0) nameCol = 0;
  // Fallback: if total amount not found, try common patterns or default to 2nd column
  if (totalAmountCol === -1) {
    totalAmountCol = header.findIndex((h, idx) => idx !== nameCol && (h.includes('valor') || h.includes('total') || h.includes('montante') || h.includes('$')));
    if (totalAmountCol === -1 && header.length > 1) totalAmountCol = 1; 
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i], sep);
    if (cols.length < 2) continue;

    const name           = cols[nameCol] || 'Dívida Importada';
    const rawTotalAmount = cols[totalAmountCol] || '0';
    const rawPaidAmount  = paidAmountCol !== -1 ? cols[paidAmountCol] : '0';
    const rawMonthly     = monthlyCol !== -1 ? cols[monthlyCol] : '0';
    const totalInst      = totalInstCol !== -1 ? parseInt(cols[totalInstCol]) : 1;
    const paidInst       = paidInstCol !== -1 ? parseInt(cols[paidInstCol]) : 0;
    const rawDate        = dueDateCol !== -1 ? cols[dueDateCol] : new Date().toISOString().slice(0, 10);
    const interest       = interestCol !== -1 ? parseAmount(cols[interestCol]) : 0;

    const totalAmount = parseAmount(rawTotalAmount);
    if (isNaN(totalAmount) || totalAmount === 0) continue;

    const paidAmount  = parseAmount(rawPaidAmount);
    const monthly     = parseAmount(rawMonthly);

    const date = normalizeDate(rawDate);
    if (!date) continue;

    debts.push({
      id: `debt-csv-${i}-${Date.now()}`,
      name: name.trim() || `Dívida ${i}`,
      category: (cols[catCol] || 'Outros') as DebtCategory,
      totalAmount,
      paidAmount: !isNaN(paidAmount) ? paidAmount : (paidInst * monthly),
      monthlyPayment: !isNaN(monthly) ? monthly : (totalAmount / totalInst),
      totalInstallments: totalInst || 1,
      paidInstallments: paidInst || 0,
      nextDueDate: date,
      interestRate: interest,
      createdAt: new Date().toISOString(),
    });
  }

  return debts;
}

export function parseFile(file: File): Promise<Transaction[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      try {
        if (file.name.toLowerCase().endsWith('.ofx') || file.name.toLowerCase().endsWith('.qfx')) {
          resolve(parseOFX(content));
        } else if (file.name.toLowerCase().endsWith('.csv')) {
          resolve(parseCSV(content));
        } else {
          const parsed = parseOFX(content);
          resolve(parsed.length > 0 ? parsed : parseCSV(content));
        }
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file, 'utf-8');
  });
}

export function parseDebtsAsGroup(file: File): Promise<{ items: Debt[], total: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      try {
        const items = parseDebtsCSV(content);
        const total = items.reduce((s, item) => s + item.totalAmount, 0);
        resolve({ items, total });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file, 'utf-8');
  });
}
