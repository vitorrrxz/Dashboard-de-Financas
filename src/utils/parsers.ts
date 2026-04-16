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

function parseOFXDate(raw: string): string {
  // OFX dates: 20231015120000[-3:BRT] or 20231015
  const clean = raw.replace(/\[.*\]/, '').trim();
  const year = clean.substring(0, 4);
  const month = clean.substring(4, 6);
  const day = clean.substring(6, 8);
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
        const m = block.match(new RegExp(`<${tag}>([^<]*)<\/${tag}>`, 'i'));
        return m ? m[1].trim() : '';
      };
      const amount = parseFloat(get('TRNAMT').replace(',', '.'));
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

      if (tag === 'TRNAMT') current.amount = parseFloat(val.replace(',', '.'));
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

export function parseCSV(content: string): Transaction[] {
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  // Split CSV line respecting quoted fields
  const splitLine = (line: string, sep: string): string[] => {
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
  };

  // Detect separator: semicolon or comma
  const sep = lines[0].includes(';') ? ';' : ',';

  const header = splitLine(lines[0], sep).map(h => h.toLowerCase().trim());
  const transactions: Transaction[] = [];

  const findCol = (...keys: string[]) =>
    keys.reduce((found, k) => found !== -1 ? found : header.findIndex(h => h.includes(k)), -1);

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

    // Normalize date: DD/MM/YYYY → YYYY-MM-DD
    let date = rawDate;
    const brDate = rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brDate) date = `${brDate[3]}-${brDate[2]}-${brDate[1]}`;
    // Also handle YYYY-MM-DD already
    const isoDate = rawDate.match(/^\d{4}-\d{2}-\d{2}$/);
    if (isoDate) date = rawDate;

    if (!date || date.length < 8) continue;

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
          // Try both
          const parsed = parseOFX(content);
          resolve(parsed.length > 0 ? parsed : parseCSV(content));
        }
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file, 'latin1');
  });
}
