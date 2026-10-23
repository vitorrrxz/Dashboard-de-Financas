// @vitest-environment jsdom
// Esconder valores: os formatadores trocam o número por "••••", e a escolha fica no navegador.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { HIDE_VALUES_STORAGE_KEY, setValuesHidden, valuesHidden } from './privacy';
import { formatBRL } from './money';
import { formatMoney } from './currency';
import { useHideValues } from '../hooks/useHideValues';

afterEach(() => setValuesHidden(false));

describe('esconder valores', () => {
  it('os valores em dinheiro viram "••••", e voltam ao mostrar', () => {
    setValuesHidden(true);
    expect(formatBRL(1234.5)).toBe('R$ ••••');
    expect(formatMoney(10, 'USD')).toBe('US$ ••••');
    setValuesHidden(false);
    expect(formatBRL(1234.5)).toBe('R$ 1.234,50');
  });

  it('a escolha fica guardada no navegador', () => {
    setValuesHidden(true);
    expect(window.localStorage.getItem(HIDE_VALUES_STORAGE_KEY)).toBe('1');
    setValuesHidden(false);
    expect(window.localStorage.getItem(HIDE_VALUES_STORAGE_KEY)).toBe('0');
  });

  it('sem armazenamento, continua funcionando até recarregar', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado'); });
    setValuesHidden(true);
    expect(valuesHidden()).toBe(true);
    vi.restoreAllMocks();
  });

  it('o hook acompanha a troca', () => {
    const { result } = renderHook(() => useHideValues());
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });
});
