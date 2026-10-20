// @vitest-environment node
// FIN-083 — temas: o script do index.html concorda com resolveTheme, os tokens de cor dos dois
// temas têm contraste WCAG AA, e nenhum componente voltou a usar cores fixas do tema escuro antigo.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import vm from 'vm';
import { resolveTheme, isThemePreference, THEME_COLORS } from '../src/utils/theme.ts';

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

/* ------------------------------ tokens do CSS ------------------------------ */
const css = read('src/index.css');
function block(selector) {
  const start = css.indexOf(selector);
  expect(start, `bloco ${selector} ausente`).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
}
// O claro é a base (@theme + :root); o escuro sobrescreve em :root[data-theme="dark"].
const themeTokens = block('@theme {');
const rootTokens = block(':root {');
const darkOverrides = block(':root[data-theme="dark"]');
const light = { ...rootTokens, ...themeTokens };
const dark = { ...light, ...darkOverrides };
const rgb = (tokens, name) => {
  const value = tokens[name];
  expect(value, `${name} não é uma cor hexadecimal`).toMatch(/^#[0-9a-f]{3,6}$/i);
  return hexToRgb(value);
};

describe('tokens de cor dos temas (FIN-083)', () => {
  it('todo token de cor do @theme tem valor no tema escuro', () => {
    const colorTokens = Object.keys(themeTokens).filter(name => name.startsWith('--color-'));
    for (const name of colorTokens) expect(darkOverrides, `${name} sem valor no tema escuro`).toHaveProperty(name);
  });

  it('as variáveis de apoio do tema claro têm valor no tema escuro', () => {
    const themed = Object.keys(rootTokens).filter(name => !name.startsWith('--fg-'));
    for (const name of themed) expect(darkOverrides, `${name} sem valor no tema escuro`).toHaveProperty(name);
  });

  it('texto, status, primária, acento e eixos com contraste AA (4,5:1) sobre fundo e cartão, nos dois temas', () => {
    for (const [theme, tokens] of [['claro', light], ['escuro', dark]]) {
      const texts = Object.keys(tokens).filter(name => /^--color-(red|teal|amber|pink|orange|blue|indigo|emerald|green)-\d+$/.test(name) || name.startsWith('--text-'));
      expect(texts.length).toBeGreaterThan(10);
      for (const name of [...texts, '--color-textMain', '--color-textMuted', '--color-primary', '--color-accent', '--color-debt', '--color-white', '--chart-axis']) {
        for (const surface of ['--color-background', '--color-card']) {
          expect(contrast(rgb(tokens, name), rgb(tokens, surface)), `${theme}: ${name} sobre ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('texto do botão primário (text-on-accent) sobre a primária tem contraste AA, nos dois temas', () => {
    for (const tokens of [light, dark]) {
      expect(contrast(rgb(tokens, '--on-primary'), rgb(tokens, '--color-primary'))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('a cor da barra do navegador de cada tema é o fundo do tema', () => {
    expect(THEME_COLORS.light).toBe(light['--color-background']);
    expect(THEME_COLORS.dark).toBe(dark['--color-background']);
  });
});

describe('script de tema do index.html (FIN-083)', () => {
  const html = read('index.html');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(code => code.includes('finflow_theme'));

  /** Roda o script inline com o armazenamento e a preferência de sistema dados; devolve o tema aplicado. */
  function runInlineScript(stored, systemLight, { withMatchMedia = true } = {}) {
    const meta = { content: THEME_COLORS.light, setAttribute(name, value) { if (name === 'content') this.content = value; } };
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
        const expected = resolveTheme(isThemePreference(stored) ? stored : 'light', systemLight);
        const { theme, themeColor } = runInlineScript(stored, systemLight);
        expect(theme, `${stored} / sistema claro: ${systemLight}`).toBe(expected);
        expect(themeColor).toBe(THEME_COLORS[expected]);
      }
    }
  });

  it('sem matchMedia ou com armazenamento bloqueado, fica no claro', () => {
    expect(runInlineScript('system', true, { withMatchMedia: false }).theme).toBe('light');
    const documentElement = { dataset: {} };
    vm.runInNewContext(script, {
      localStorage: { getItem: () => { throw new Error('SecurityError'); } },
      window: {},
      document: { documentElement, querySelector: () => null },
    });
    expect(documentElement.dataset.theme).toBe('light');
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
