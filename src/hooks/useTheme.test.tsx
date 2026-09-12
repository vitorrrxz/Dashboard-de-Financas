// FIN-083 — hook do tema: padrão, escolha persistida, "igual ao sistema" acompanhando o sistema.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTheme } from './useTheme';
import { THEME_STORAGE_KEY } from '../utils/theme';

const originalMatchMedia = window.matchMedia;

/** `prefers-color-scheme: light` controlável, avisando quem está ouvindo. */
function mockSystemTheme(light: boolean) {
  let matches = light;
  const listeners = new Set<() => void>();
  window.matchMedia = vi.fn((query: string) => ({
    get matches() { return query === '(prefers-color-scheme: light)' ? matches : false; },
    media: query,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
  return { setLight(value: boolean) { matches = value; act(() => listeners.forEach(l => l())); } };
}

describe('useTheme (FIN-083)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    delete document.documentElement.dataset.theme;
    localStorage.clear();
  });

  it('sem preferência salva, aplica o tema escuro', () => {
    mockSystemTheme(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current).toMatchObject({ preference: 'dark', resolved: 'dark' });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('aplica a preferência salva e persiste a nova escolha', () => {
    mockSystemTheme(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');

    act(() => result.current.setPreference('dark'));
    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('"igual ao sistema" acompanha a troca de tema do sistema operacional', () => {
    const system = mockSystemTheme(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference('system'));
    expect(result.current.resolved).toBe('dark');

    system.setLight(true);
    expect(result.current.resolved).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    system.setLight(false);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('"igual ao sistema" sem suporte a media query fica no escuro', () => {
    // @ts-expect-error — simula um navegador sem a API
    delete window.matchMedia;
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    const { result } = renderHook(() => useTheme());
    expect(result.current).toMatchObject({ preference: 'system', resolved: 'dark' });
  });
});
