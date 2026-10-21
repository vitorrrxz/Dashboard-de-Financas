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

/**
 * Props de animação dos gráficos do Recharts: barras crescem, a pizza gira e a linha se desenha
 * ao montar e ao trocar os dados. Quem pede menos movimento no sistema vê o gráfico pronto.
 * Os objetos são fixos para que um gráfico memoizado não re-renderize à toa.
 */
const CHART_ANIMATED = { isAnimationActive: true, animationBegin: 0, animationDuration: 1100, animationEasing: 'ease-in-out' } as const;
const CHART_STILL = { ...CHART_ANIMATED, isAnimationActive: false } as const;

export function useChartAnimation() {
  return useMediaQuery('(prefers-reduced-motion: reduce)') ? CHART_STILL : CHART_ANIMATED;
}
