import { useCallback, useSyncExternalStore } from 'react';

const hasMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/**
 * Se a media query casa agora — e re-renderiza quando ela muda (girar o celular, redimensionar a
 * janela, trocar o tema do sistema). Sem `matchMedia` (jsdom, navegador muito antigo), vale `false`.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (!hasMatchMedia()) return () => {};
    const list = window.matchMedia(query);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  const getSnapshot = () => hasMatchMedia() && window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
