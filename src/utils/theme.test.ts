// FIN-083 — preferência de tema: leitura e gravação no navegador, tema efetivo e aplicação.
import { describe, it, expect, afterEach } from 'vitest';
import {
  THEME_COLORS, THEME_STORAGE_KEY, applyTheme, readStoredTheme, readableColor, resolveTheme, storeTheme,
} from './theme';

const storageWith = (value: string | null) => ({ getItem: (key: string) => (key === THEME_STORAGE_KEY ? value : null) });

describe('readStoredTheme / storeTheme (FIN-083)', () => {
  it('lê as três preferências válidas', () => {
    for (const value of ['dark', 'light', 'system'] as const) expect(readStoredTheme(storageWith(value))).toBe(value);
  });

  it('sem valor, valor desconhecido ou armazenamento que lança: tema escuro', () => {
    for (const value of [null, '', 'azul', 'LIGHT', ' light']) expect(readStoredTheme(storageWith(value))).toBe('dark');
    expect(readStoredTheme(null)).toBe('dark');
    expect(readStoredTheme({ getItem: () => { throw new DOMException('bloqueado', 'SecurityError'); } })).toBe('dark');
  });

  it('grava na chave do app e engole a falha de um armazenamento cheio ou bloqueado', () => {
    const saved: Record<string, string> = {};
    storeTheme('light', { setItem: (key, value) => { saved[key] = value; } });
    expect(saved).toEqual({ [THEME_STORAGE_KEY]: 'light' });
    expect(() => storeTheme('dark', { setItem: () => { throw new DOMException('cheio', 'QuotaExceededError'); } })).not.toThrow();
    expect(() => storeTheme('dark', null)).not.toThrow();
  });
});

describe('resolveTheme (FIN-083)', () => {
  it('escolha explícita vale sempre; "sistema" segue o sistema operacional', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
  });
});

describe('applyTheme (FIN-083)', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
    document.head.querySelector('meta[name="theme-color"]')?.remove();
  });

  it('marca o <html> e troca a cor da barra do navegador', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = THEME_COLORS.dark;
    document.head.appendChild(meta);

    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(meta.content).toBe(THEME_COLORS.light);
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(meta.content).toBe(THEME_COLORS.dark);
  });

  it('sem a meta theme-color no documento, só marca o <html>', () => {
    expect(() => applyTheme('light')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('readableColor (FIN-083)', () => {
  it('mistura a cor com a de contraste na proporção do tema', () => {
    expect(readableColor('#f59e0b')).toBe('color-mix(in srgb, #f59e0b var(--tint-strength), var(--color-white))');
  });
});
