// FIN-060/FIN-061 — exportação de relatórios (CSV e PDF).
//
// A montagem do CSV é separada do download para poder ser testada sem DOM (`buildCSV`), e
// o download em si ficou centralizado aqui porque o mesmo fluxo já existia duplicado em
// `DebtManager.exportCSV`.

/** Uma célula de planilha: texto ou número (convertido na serialização). */
export type CSVCell = string | number;

/**
 * Monta o conteúdo de um CSV no dialeto que o Excel em português espera:
 * separador `;` (o `,` é separador decimal em pt-BR) e todo campo entre aspas, com aspas
 * internas duplicadas conforme o RFC 4180 — sem isso, um nome de transação com `;` ou `"`
 * quebraria as colunas do arquivo.
 */
export function buildCSV(headers: string[], rows: CSVCell[][]): string {
  const escapeCell = (cell: CSVCell) => `"${String(cell).replace(/"/g, '""')}"`;
  return [headers, ...rows]
    .map(row => row.map(escapeCell).join(';'))
    .join('\n');
}

/** Formata um valor monetário para planilha em pt-BR ("1234,56"), sem símbolo de moeda. */
export function formatCurrencyCSV(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

/**
 * Dispara o download de um arquivo no navegador a partir de um Blob.
 *
 * O link precisa estar anexado ao documento antes do clique (o Firefox ignora o clique em
 * um `<a>` fora da árvore) e a URL só é revogada no próximo tick — revogar imediatamente
 * após o `click()` cancela downloads ainda não iniciados em alguns navegadores.
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 0);
}

/** Byte Order Mark: sem ele o Excel abre o CSV como ANSI e corrompe os acentos ("TransaÃ§Ã£o"). */
const UTF8_BOM = '\uFEFF';

/** Gera e baixa um CSV com BOM, para o Excel reconhecer o arquivo como UTF-8. */
export function downloadCSV(filename: string, headers: string[], rows: CSVCell[][]): void {
  const blob = new Blob([UTF8_BOM + buildCSV(headers, rows)], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, filename);
}

/** Sufixo de data (YYYY-MM-DD) usado nos nomes de arquivo exportados. */
export function exportDateSuffix(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface PDFReportOptions {
  /** Título impresso no topo da primeira página. */
  title: string;
  /** Linhas de resumo impressas abaixo do título (ex.: período, totais). */
  subtitles?: string[];
  headers: string[];
  rows: CSVCell[][];
  filename: string;
}

/**
 * Gera e baixa um PDF em formato de tabela.
 *
 * `jspdf` + `jspdf-autotable` são carregados por `import()` dinâmico, não no topo do
 * módulo: juntas são as maiores dependências do projeto (~350 kB), e a maioria das sessões
 * nunca exporta um PDF. Assim o custo só é pago por quem clica em "Exportar PDF", em vez
 * de entrar no bundle inicial de todo mundo.
 */
export async function downloadPDFReport({ title, subtitles = [], headers, rows, filename }: PDFReportOptions): Promise<void> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = autoTableModule.default;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  doc.setFontSize(16);
  doc.text(title, 40, 40);

  doc.setFontSize(10);
  doc.setTextColor(120);
  subtitles.forEach((line, i) => doc.text(line, 40, 60 + i * 14));

  autoTable(doc, {
    head: [headers],
    body: rows.map(row => row.map(String)),
    startY: 70 + subtitles.length * 14,
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [99, 102, 241], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 245, 250] },
    margin: { left: 40, right: 40 },
  });

  doc.save(filename);
}
