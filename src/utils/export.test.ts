// FIN-060 — montagem do CSV. O download em si depende de DOM/Blob e não é testado aqui;
// o que importa validar é a serialização, onde moram os erros que corrompem a planilha.
import { describe, it, expect } from 'vitest';
import { buildCSV, formatCurrencyCSV, exportDateSuffix } from './export';

describe('buildCSV', () => {
  it('usa ponto e vírgula como separador (dialeto pt-BR do Excel)', () => {
    const csv = buildCSV(['A', 'B'], [['1', '2']]);
    expect(csv.split('\n')[0]).toBe('"A";"B"');
    expect(csv.split('\n')[1]).toBe('"1";"2"');
  });

  it('escapa aspas duplicando-as, conforme o RFC 4180', () => {
    const csv = buildCSV(['Descrição'], [['Compra "especial"']]);
    expect(csv.split('\n')[1]).toBe('"Compra ""especial"""');
  });

  it('mantém intacto um campo que contém o próprio separador', () => {
    const csv = buildCSV(['Descrição'], [['Mercado; Padaria']]);
    // O campo continua sendo UMA célula, entre aspas — não vira duas colunas.
    expect(csv.split('\n')[1]).toBe('"Mercado; Padaria"');
  });

  it('preserva quebras de linha dentro de um campo sem gerar uma linha nova de dados', () => {
    const csv = buildCSV(['Obs'], [['linha1\nlinha2']]);
    expect(csv).toContain('"linha1\nlinha2"');
  });

  it('converte números para texto', () => {
    const csv = buildCSV(['Valor'], [[42]]);
    expect(csv.split('\n')[1]).toBe('"42"');
  });

  it('sem linhas, exporta só o cabeçalho', () => {
    expect(buildCSV(['A', 'B'], [])).toBe('"A";"B"');
  });
});

describe('formatCurrencyCSV', () => {
  it('usa vírgula como separador decimal e sempre duas casas', () => {
    expect(formatCurrencyCSV(1234.5)).toBe('1234,50');
    expect(formatCurrencyCSV(0)).toBe('0,00');
  });

  it('mantém o sinal de valores negativos', () => {
    expect(formatCurrencyCSV(-99.9)).toBe('-99,90');
  });

  it('arredonda para centavos', () => {
    expect(formatCurrencyCSV(10.005)).toBe('10,01');
  });
});

describe('exportDateSuffix', () => {
  it('devolve a data local no formato YYYY-MM-DD', () => {
    expect(exportDateSuffix()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
