// FIN-083 — tema claro/escuro. A preferência fica no navegador (`localStorage`); o tema efetivo
// vai para `data-theme` no <html>, e os tokens de cor de src/index.css fazem o resto. O script
// inline do index.html repete `resolveTheme` para aplicar o tema antes da primeira pintura — um
// teste confere que os dois concordam.

export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'finflow_theme';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['dark', 'light', 'system'];
/** Cor da barra do navegador e do sistema (`<meta name="theme-color">`): o fundo de cada tema. */
export const THEME_COLORS: Record<ResolvedTheme, string> = { dark: '#0a0a0f', light: '#f3f4f9' };
/** Sem preferência salva, o tema escuro — o visual original do app. */
export const DEFAULT_THEME: ThemePreference = 'dark';

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** `localStorage`, ou `null` onde o próprio acesso lança (navegação privada restrita, iframe sandbox). */
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Preferência salva; valor ausente, desconhecido ou armazenamento inacessível valem o padrão. */
export function readStoredTheme(storage: Pick<Storage, 'getItem'> | null = browserStorage()): ThemePreference {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(value) ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Salva a preferência. Sem armazenamento disponível, ela vale só até fechar a página. */
export function storeTheme(preference: ThemePreference, storage: Pick<Storage, 'setItem'> | null = browserStorage()): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Cota cheia ou armazenamento bloqueado: não há o que fazer além de seguir sem persistir.
  }
}

/** Tema efetivo. "Igual ao sistema" segue o sistema operacional; sem essa informação, fica o escuro. */
export function resolveTheme(preference: ThemePreference, systemPrefersLight: boolean): ResolvedTheme {
  if (preference === 'system') return systemPrefersLight ? 'light' : 'dark';
  return preference;
}

/** Aplica o tema ao documento: `data-theme` no <html> e a cor da barra do navegador. */
export function applyTheme(theme: ResolvedTheme, doc: Document = document): void {
  doc.documentElement.dataset.theme = theme;
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}

/**
 * Uma cor de dado (categoria, tipo de pagamento) usada como TEXTO, legível nos dois temas: pura
 * no escuro e misturada com a cor de contraste no claro, onde tons como o âmbar puro ficariam
 * ilegíveis sobre o fundo branco. A proporção vem de `--tint-strength` (index.css).
 */
export function readableColor(hex: string): string {
  return `color-mix(in srgb, ${hex} var(--tint-strength), var(--color-white))`;
}
