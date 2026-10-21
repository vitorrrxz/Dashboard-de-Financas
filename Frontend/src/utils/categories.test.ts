import { describe, it, expect } from 'vitest';
import { CATEGORY_PALETTE, categoryColor } from './categories';

describe('categoryColor', () => {
  it('a mesma categoria tem sempre a mesma cor, e as livres caem na paleta', () => {
    expect(categoryColor('Uma categoria qualquer')).toBe(categoryColor('Uma categoria qualquer'));
    expect(CATEGORY_PALETTE).toContain(categoryColor('Pet shop e veterinário'));
  });

  it('as categorias comuns que aparecem juntas não repetem cor', () => {
    const top = ['Vestuário', 'Transferência - PIX', 'Compras', 'Transferências', 'Serviços', 'Supermercado'];
    expect(new Set(top.map(categoryColor)).size).toBe(top.length);
  });
});
