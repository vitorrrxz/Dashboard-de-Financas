// @vitest-environment node
// FIN-083 — tema claro: o script do index.html concorda com resolveTheme, os tokens de cor dos
// dois temas têm contraste WCAG AA, e nenhum componente voltou a usar cores fixas do tema escuro.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import vm from 'vm';
import { resolveTheme, isThemePreference, THEME_COLORS } from '../src/utils/theme.ts';
import { CATEGORY_COLORS } from '../src/utils/categories.ts';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/* ---------------------------- contraste (WCAG 2.x) ---------------------------- */
const hexToRgb = hex => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map(c => c + c).join('') : h;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
};
const luminance = rgb => {
  const [r, g, b] = rgb.map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
/** color-mix(in srgb, a p, b) — o que readableColor() produz. */
const mix = (a, p, b) => a.map((v, i) => v * p + b[i] * (1 - p));

/* ------------------------------ tokens do CSS ------------------------------ */
const css = read('src/index.css');
function block(selector) {
  const start = css.indexOf(selector);
  expect(start, `bloco ${selector} ausente`).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
}
const themeTokens = block('@theme');
const rootTokens = block(':root {');
const light = block(':root[data-theme="light"]');
const dark = { ...rootTokens, ...themeTokens, '--color-white': '#ffffff' };
const lightAll = { ...dark, ...light };
const rgb = (tokens, name) => {
  const value = tokens[name];
  expect(value, `${name} não é uma cor hexadecimal`).toMatch(/^#[0-9a-f]{3,6}$/i);
  return hexToRgb(value);
};

// Cores de dado exibidas como texto: categorias, tipos de pagamento e categorias de dívida.
const DATA_COLORS = [...new Set([
  ...Object.values(CATEGORY_COLORS),
  '#3b82f6', '#ec4899', '#10b981', '#f59e0b', '#a855f7', '#6b7280',
])];

describe('tokens de cor dos temas (FIN-083)', () => {
  it('todo token de cor do @theme tem valor no tema claro', () => {
    const colorTokens = Object.keys(themeTokens).filter(name => name.startsWith('--color-'));
    for (const name of colorTokens) expect(light, `${name} sem valor no tema claro`).toHaveProperty(name);
  });

  it('as variáveis de apoio do tema escuro têm valor no tema claro', () => {
    const themed = Object.keys(rootTokens).filter(name => !name.startsWith('--fg-'));
    for (const name of themed) expect(light, `${name} sem valor no tema claro`).toHaveProperty(name);
  });

  it('texto principal e secundário com contraste AA (4,5:1) sobre fundo e cartão, nos dois temas', () => {
    for (const tokens of [dark, lightAll]) {
      for (const text of ['--color-textMain', '--color-textMuted']) {
        for (const surface of ['--color-background', '--color-card']) {
          expect(contrast(rgb(tokens, text), rgb(tokens, surface)), `${text} sobre ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('no claro, os tons de texto redefinidos, a primária e o acento têm contraste AA', () => {
    const texts = Object.keys(light).filter(name => /^--color-(red|teal|amber|pink|orange|blue|indigo)-\d+$/.test(name) || name.startsWith('--text-'));
    expect(texts.length).toBeGreaterThan(10);
    for (const name of [...texts, '--color-primary', '--color-accent', '--color-white', '--chart-axis']) {
      for (const surface of ['--color-background', '--color-card']) {
        expect(contrast(rgb(lightAll, name), rgb(lightAll, surface)), `${name} sobre ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('no claro, texto branco (text-on-accent) sobre a primária e a secundária tem contraste AA', () => {
    for (const name of ['--color-primary', '--color-secondary']) {
      expect(contrast([255, 255, 255], rgb(lightAll, name)), `branco sobre ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('cores de dado como texto (readableColor) ficam legíveis no claro', () => {
    const strength = parseFloat(light['--tint-strength']) / 100;
    expect(dark['--tint-strength']).toBe('100%');
    for (const color of DATA_COLORS) {
      const text = mix(hexToRgb(color), strength, rgb(lightAll, '--color-white'));
      for (const surface of ['--color-background', '--color-card']) {
        expect(contrast(text, rgb(lightAll, surface)), `${color} sobre ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('a cor da barra do navegador de cada tema é o fundo do tema', () => {
    expect(THEME_COLORS.dark).toBe(dark['--color-background']);
    expect(THEME_COLORS.light).toBe(light['--color-background']);
  });
});

describe('script de tema do index.html (FIN-083)', () => {
  const html = read('index.html');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(code => code.includes('finflow_theme'));

  /** Roda o script inline com o armazenamento e a preferência de sistema dados; devolve o tema aplicado. */
  function runInlineScript(stored, systemLight, { withMatchMedia = true } = {}) {
    const meta = { content: THEME_COLORS.dark, setAttribute(name, value) { if (name === 'content') this.content = value; } };
    const documentElement = { dataset: {} };
    const sandbox = {
      localStorage: { getItem: key => (key === 'finflow_theme' ? stored : null) },
      window: withMatchMedia ? { matchMedia: query => ({ matches: query === '(prefers-color-scheme: light)' && systemLight }) } : {},
      document: { documentElement, querySelector: selector => (selector === 'meta[name="theme-color"]' ? meta : null) },
    };
    vm.runInNewContext(script, sandbox);
    return { theme: documentElement.dataset.theme, themeColor: meta.content };
  }

  it('existe e roda antes do CSS do app', () => {
    expect(script).toBeTruthy();
    expect(html.indexOf('finflow_theme')).toBeLessThan(html.indexOf('/src/main.tsx'));
  });

  it('concorda com resolveTheme em todas as combinações de preferência e sistema', () => {
    for (const stored of [null, 'dark', 'light', 'system', 'azul']) {
      for (const systemLight of [true, false]) {
        const expected = resolveTheme(isThemePreference(stored) ? stored : 'dark', systemLight);
        const { theme, themeColor } = runInlineScript(stored, systemLight);
        expect(theme, `${stored} / sistema claro: ${systemLight}`).toBe(expected);
        expect(themeColor).toBe(THEME_COLORS[expected]);
      }
    }
  });

  it('sem matchMedia ou com armazenamento bloqueado, fica no escuro', () => {
    expect(runInlineScript('system', true, { withMatchMedia: false }).theme).toBe('dark');
    const documentElement = { dataset: {} };
    vm.runInNewContext(script, {
      localStorage: { getItem: () => { throw new Error('SecurityError'); } },
      window: {},
      document: { documentElement, querySelector: () => null },
    });
    expect(documentElement.dataset.theme).toBe('dark');
  });
});

describe('cores fixas do tema escuro nos componentes (FIN-083)', () => {
  it('nenhum componente usa os fundos e véus fixos do tema escuro — só os tokens do index.css', () => {
    const forbidden = /rgba\(\s*255\s*,\s*255\s*,\s*255|#0a0a0f|#12121a|#1c1c24|#1e1e2e/i;
    const offenders = [];
    const walk = dir => {
      for (const entry of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          read(path).split('\n').forEach((line, i) => { if (forbidden.test(line)) offenders.push(`${path}:${i + 1}: ${line.trim()}`); });
        }
      }
    };
    walk('src');
    // O fundo do tema escuro aparece uma vez, de propósito, como a cor da barra do navegador.
    expect(offenders.filter(o => !o.startsWith('src/utils/theme.ts:'))).toEqual([]);
  });
});
