import { useCallback, useEffect, useState } from 'react';
import { useMediaQuery } from './useMediaQuery';
import { applyTheme, readStoredTheme, resolveTheme, storeTheme, type ThemePreference } from '../utils/theme';

/**
 * FIN-083 — preferência de tema (escuro, claro ou igual ao sistema), salva no navegador, e o tema
 * efetivo aplicado ao documento. Com "igual ao sistema", acompanha a troca de tema do sistema
 * operacional sem recarregar a página.
 */
export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredTheme());
  // "light", e não "dark": sem suporte a media query, o resultado é `false`, e vale o tema escuro.
  const systemPrefersLight = useMediaQuery('(prefers-color-scheme: light)');
  const resolved = resolveTheme(preference, systemPrefersLight);

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    storeTheme(next);
  }, []);

  return { preference, resolved, setPreference };
}
