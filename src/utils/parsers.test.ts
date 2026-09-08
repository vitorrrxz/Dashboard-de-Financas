// FIN-035 — cobertura de src/utils/parsers.ts, o ponto de entrada de dados financeiros
// mais crítico do app (importação de extrato CSV/OFX).
import { describe, it, expect } from 'vitest';
import { parseAmount, normalizeDate, autoCategory, parseOFX, parseCSV } from './parsers';

describe('parseAmount', () => {
  it('formato BR (vírgula decimal)', () => {
    expect(parseAmount('150,00')).toBe(150);
    expect(parseAmount('1.500,00')).toBe(1500);
    expect(parseAmount('-89,90')).toBe(-89.9);
  });

  it('formato US (ponto decimal)', () => {
    expect(parseAmount('150.00')).toBe(150);
    expect(parseAmount('1,500.00')).toBe(1500);
  });

  it('só vírgula, sem indicação de milhar (assume decimal BR)', () => {
    expect(parseAmount('150,5')).toBe(150.5);
  });

  it('só vírgula com 3+ dígitos após (assume milhar)', () => {
    expect(parseAmount('1,500')).toBe(1500);
  });

  it('valor com prefixo R$ e espaços', () => {
    expect(parseAmount('R$ 150,00')).toBe(150);
    expect(parseAmount(' 150,00 ')).toBe(150);
  });

  it('valores inválidos retornam NaN', () => {
    expect(parseAmount('')).toBeNaN();
    expect(parseAmount('-')).toBeNaN();
    expect(parseAmount('abc')).toBeNaN();
  });
});

describe('normalizeDate', () => {
  it('DD/MM/YYYY', () => {
    expect(normalizeDate('15/10/2023')).toBe('2023-10-15');
    expect(normalizeDate('5/1/2023')).toBe('2023-01-05');
  });

  it('YYYY-MM-DD (já normalizado)', () => {
    expect(normalizeDate('2023-10-15')).toBe('2023-10-15');
  });

  it('DD-MM-YYYY', () => {
    expect(normalizeDate('15-10-2023')).toBe('2023-10-15');
  });

  it('YYYY/MM/DD', () => {
    expect(normalizeDate('2023/10/15')).toBe('2023-10-15');
  });

  it('formato inválido retorna string vazia', () => {
    expect(normalizeDate('não é uma data')).toBe('');
    expect(normalizeDate('')).toBe('');
  });
});

describe('autoCategory', () => {
  it('mapeia palavras-chave conhecidas para cada categoria', () => {
    expect(autoCategory('IFOOD *DELIVERY')).toBe('Alimentação');
    expect(autoCategory('UBER TRIP')).toBe('Transporte');
    expect(autoCategory('NETFLIX.COM')).toBe('Lazer');
    expect(autoCategory('ALUGUEL APTO')).toBe('Moradia');
    expect(autoCategory('DROGARIA SAO PAULO')).toBe('Saúde');
    expect(autoCategory('PIX RECEBIDO')).toBe('Receita');
    expect(autoCategory('UDEMY CURSO')).toBe('Educação');
    expect(autoCategory('AMERICANAS COMPRA')).toBe('Compras');
  });

  it('quando a descrição contém palavras-chave de mais de uma categoria, vence a que aparece primeiro em CATEGORY_RULES (Alimentação antes de Compras)', () => {
    // "mercado" (Alimentação) é checado antes de "mercado livre" (Compras) — comportamento
    // atual documentado, não uma ambiguidade tratada por especificidade.
    expect(autoCategory('MERCADO LIVRE COMPRA')).toBe('Alimentação');
  });

  it('descrição sem palavra-chave conhecida cai em Outros', () => {
    expect(autoCategory('XYZ ALGO DESCONHECIDO 123')).toBe('Outros');
  });
});

describe('parseOFX', () => {
  const xmlOfx = `
    <OFX>
      <BANKTRANLIST>
        <STMTTRN>
          <TRNTYPE>DEBIT</TRNTYPE>
          <DTPOSTED>20231015</DTPOSTED>
          <TRNAMT>-89.90</TRNAMT>
          <FITID>ABC123</FITID>
          <MEMO>IFOOD DELIVERY</MEMO>
        </STMTTRN>
        <STMTTRN>
          <TRNTYPE>CREDIT</TRNTYPE>
          <DTPOSTED>20231020</DTPOSTED>
          <TRNAMT>1500.00</TRNAMT>
          <NAME>SALARIO</NAME>
        </STMTTRN>
      </BANKTRANLIST>
    </OFX>
  `;

  it('extrai transações do formato XML-style, com FITID como externalId', () => {
    const txs = parseOFX(xmlOfx);
    expect(txs).toHaveLength(2);
    expect(txs[0]).toMatchObject({ id: 'ABC123', externalId: 'ABC123', name: 'IFOOD DELIVERY', date: '2023-10-15', amount: -89.9, category: 'Alimentação' });
  });

  it('sem FITID, gera um id sintético e externalId fica undefined', () => {
    const txs = parseOFX(xmlOfx);
    expect(txs[1].externalId).toBeUndefined();
    expect(txs[1].id).toMatch(/^ofx-1-/);
    expect(txs[1].category).toBe('Receita');
  });

  // A regex que detecta blocos "XML-style" (`<STMTTRN>([\s\S]*?)<\/STMTTRN>`) casa com
  // QUALQUER conteúdo que tenha o par de tags externas `<STMTTRN>`/`</STMTTRN>`, mesmo que
  // os campos internos (`<TRNAMT>`, `<FITID>` etc.) não tenham fechamento — formato SGML
  // legítimo, onde só a tag externa costuma ser fechada. Isso significa que o branch
  // "SGML-style" abaixo só é alcançado quando NEM a tag externa é fechada.
  const sgmlOfxWithClosingOuterTag = [
    '<STMTTRN>',
    '<TRNTYPE>DEBIT',
    '<DTPOSTED>20231015',
    '<TRNAMT>-50.00',
    '<FITID>SGML1',
    '<MEMO>UBER TRIP',
    '</STMTTRN>',
  ].join('\n');

  it('achado: SGML com tag externa `</STMTTRN>` fechada mas campos internos sem fechamento cai no branch XML e perde a transação silenciosamente (ver FIN-091)', () => {
    // `get('TRNAMT')` procura `<TRNAMT>...</TRNAMT>` (fechado) e não encontra nada nesse
    // input — retorna '', vira NaN, e a transação é descartada pelo filtro final.
    // Nenhuma exceção é lançada, mas a transação desaparece silenciosamente da importação.
    expect(parseOFX(sgmlOfxWithClosingOuterTag)).toEqual([]);
  });

  const sgmlOfxNoClosingTagAtAll = [
    '<STMTTRN>',
    '<TRNTYPE>DEBIT',
    '<DTPOSTED>20231015',
    '<TRNAMT>-50.00',
    '<FITID>SGML1',
    '<MEMO>UBER TRIP',
  ].join('\n');

  it('achado: sem NENHUMA tag `</STMTTRN>` (SGML "puro"), o branch SGML é alcançado mas nunca faz `push` — só grava ao encontrar a linha literal `</STMTTRN>` (ver FIN-091)', () => {
    expect(parseOFX(sgmlOfxNoClosingTagAtAll)).toEqual([]);
  });

  it('conteúdo sem blocos STMTTRN retorna lista vazia, sem lançar exceção', () => {
    expect(parseOFX('não é um OFX válido')).toEqual([]);
  });
});

describe('parseCSV', () => {
  it('separador vírgula, colunas em português', () => {
    const csv = 'data,descrição,valor\n15/10/2023,IFOOD DELIVERY,-89.90\n20/10/2023,SALARIO,1500.00';
    const txs = parseCSV(csv);
    expect(txs).toHaveLength(2);
    expect(txs[0]).toMatchObject({ date: '2023-10-15', name: 'IFOOD DELIVERY', amount: -89.9, category: 'Alimentação' });
    expect(txs[1]).toMatchObject({ date: '2023-10-20', name: 'SALARIO', amount: 1500, category: 'Receita' });
  });

  it('separador ponto-e-vírgula, colunas em inglês, valores em formato BR', () => {
    const csv = 'date;description;amount\n15/10/2023;UBER TRIP;-50,00';
    const txs = parseCSV(csv);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ date: '2023-10-15', name: 'UBER TRIP', amount: -50 });
  });

  it('linhas com data ou valor inválido são ignoradas, sem lançar exceção', () => {
    const csv = 'data,descrição,valor\ndata-invalida,Teste,100,00\n15/10/2023,OK,-10,00';
    const txs = parseCSV(csv);
    expect(txs).toHaveLength(1);
    expect(txs[0].name).toBe('OK');
  });

  it('duas linhas idênticas no mesmo arquivo NÃO são deduplicadas pelo parser (dedupe é responsabilidade do backend, ver FIN-003)', () => {
    const csv = 'data,descrição,valor\n15/10/2023,Repetida,-10,00\n15/10/2023,Repetida,-10,00';
    const txs = parseCSV(csv);
    expect(txs).toHaveLength(2);
  });

  it('CSV sem coluna de data ou valor retorna lista vazia', () => {
    expect(parseCSV('col1,col2\na,b')).toEqual([]);
  });

  it('menos de 2 linhas (só cabeçalho ou vazio) retorna lista vazia', () => {
    expect(parseCSV('data,descrição,valor')).toEqual([]);
    expect(parseCSV('')).toEqual([]);
  });
});
