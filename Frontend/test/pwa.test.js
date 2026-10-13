// @vitest-environment node
// FIN-082 — PWA: manifesto e ícones, cabeçalho do index.html e o service worker (public/sw.js),
// executado num contexto isolado com `caches`, `fetch` e eventos simulados.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import vm from 'vm';

const ORIGIN = 'https://finflow.test';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** Largura e altura gravadas no cabeçalho IHDR de um PNG. */
function pngSize(path) {
  const buf = readFileSync(new URL(`../public${path}`, import.meta.url));
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

describe('manifesto e index.html (FIN-082)', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  const html = read('index.html');

  it('manifesto com o que o navegador exige para instalar', () => {
    expect(manifest).toMatchObject({ name: expect.stringContaining('FinFlow'), short_name: 'FinFlow', start_url: '/', scope: '/', display: 'standalone', lang: 'pt-BR' });
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('ícones PNG de 192 e 512 px, um "maskable", todos existentes e com o tamanho declarado', () => {
    const pngs = manifest.icons.filter(icon => icon.type === 'image/png');
    for (const icon of pngs) expect(pngSize(icon.src)).toBe(icon.sizes);
    const sizes = pngs.map(icon => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(pngs.some(icon => icon.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) expect(existsSync(new URL(`../public${icon.src}`, import.meta.url))).toBe(true);
  });

  it('index.html liga o manifesto, o ícone do iOS e a cor do tema igual à do manifesto, em pt-BR', () => {
    expect(html).toContain('<html lang="pt-BR"');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain(`<meta name="theme-color" content="${manifest.theme_color}"`);
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png"');
    expect(pngSize('/apple-touch-icon.png')).toBe('180x180');
  });
});

describe('service worker (FIN-082)', () => {
  const source = read('public/sw.js');
  let handlers;
  let fetchMock;
  let cacheStorage;
  let self;

  /** CacheStorage em memória; `match` devolve cópias, como o de verdade. */
  function createCacheStorage() {
    const stores = new Map();
    const keyOf = request => (typeof request === 'string' ? new URL(request, ORIGIN).href : request.url);
    const open = async name => {
      if (!stores.has(name)) {
        const entries = new Map();
        stores.set(name, {
          entries,
          match: async request => entries.get(keyOf(request))?.clone(),
          put: async (request, response) => { entries.delete(keyOf(request)); entries.set(keyOf(request), response); },
          keys: async () => [...entries.keys()].map(url => ({ url })),
          delete: async request => entries.delete(keyOf(request)),
          addAll: async urls => {
            for (const url of urls) {
              const response = await fetchMock({ url: new URL(url, ORIGIN).href, method: 'GET' });
              if (!response.ok) throw new TypeError(`addAll: ${url} respondeu ${response.status}`);
              entries.set(keyOf(url), response);
            }
          },
        });
      }
      return stores.get(name);
    };
    return { open, keys: async () => [...stores.keys()], delete: async name => stores.delete(name), stores };
  }

  const text = (body, init = {}) => new Response(body, { status: 200, ...init });

  beforeEach(() => {
    handlers = {};
    cacheStorage = createCacheStorage();
    fetchMock = vi.fn(async request => text(`rede: ${request.url}`));
    self = {
      location: { origin: ORIGIN },
      addEventListener: (type, handler) => { handlers[type] = handler; },
      skipWaiting: vi.fn(async () => {}),
      clients: { claim: vi.fn(async () => {}) },
    };
    vm.runInNewContext(source, { self, caches: cacheStorage, fetch: (...args) => fetchMock(...args), URL, Response, Set, console });
  });

  async function dispatch(type) {
    let pending;
    handlers[type]({ waitUntil: promise => { pending = promise; } });
    await pending;
  }

  /** Dispara um fetch; devolve a resposta do service worker, ou `null` se ele deixou passar. */
  async function request(path, { method = 'GET', mode = 'cors', origin = ORIGIN } = {}) {
    let responded = null;
    handlers.fetch({ request: { url: new URL(path, origin).href, method, mode }, respondWith: promise => { responded = promise; } });
    return responded ? await responded : null;
  }

  const shellEntries = async () => [...(await cacheStorage.open('finflow-shell-v1')).entries.keys()];
  const assetEntries = async () => [...(await cacheStorage.open('finflow-assets-v1')).entries.keys()];

  it('instalação guarda a casca e os arquivos de entrada citados no HTML, e assume na hora', async () => {
    fetchMock.mockImplementation(async req => (req.url === `${ORIGIN}/`
      ? text('<script type="module" src="/assets/index-abc123.js"></script><link rel="stylesheet" href="/assets/index-def456.css">')
      : text(`arquivo ${req.url}`)));
    await dispatch('install');

    expect(await shellEntries()).toEqual(expect.arrayContaining([`${ORIGIN}/`, `${ORIGIN}/manifest.webmanifest`, `${ORIGIN}/icons/icon-512.png`]));
    expect(await assetEntries()).toEqual([`${ORIGIN}/assets/index-abc123.js`, `${ORIGIN}/assets/index-def456.css`]);
    expect(self.skipWaiting).toHaveBeenCalled();
  });

  it('ativação apaga os caches de versões antigas do FinFlow e mantém os demais', async () => {
    await cacheStorage.open('finflow-shell-v0');
    await cacheStorage.open('finflow-assets-v0');
    await cacheStorage.open('outro-app');
    await cacheStorage.open('finflow-shell-v1');
    await dispatch('activate');
    expect(await cacheStorage.keys()).toEqual(['outro-app', 'finflow-shell-v1']);
    expect(self.clients.claim).toHaveBeenCalled();
  });

  it('nunca intercepta a API, outras origens nem métodos que não sejam GET', async () => {
    expect(await request('/api/transactions')).toBeNull();
    expect(await request('/api/account/export', { mode: 'navigate' })).toBeNull();
    expect(await request('/transactions', { origin: 'http://localhost:3001' })).toBeNull();
    expect(await request('/pluggy-connect.js', { origin: 'https://cdn.pluggy.ai' })).toBeNull();
    expect(await request('/assets/index.js', { method: 'POST' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await cacheStorage.keys()).toEqual([]);
  });

  it('/assets/: cache primeiro — a segunda busca não vai à rede', async () => {
    const first = await request('/assets/app-1.js');
    expect(await first.text()).toBe(`rede: ${ORIGIN}/assets/app-1.js`);
    const second = await request('/assets/app-1.js');
    expect(await second.text()).toBe(`rede: ${ORIGIN}/assets/app-1.js`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('não guarda respostas de erro nem as marcadas no-store', async () => {
    fetchMock.mockResolvedValueOnce(text('não achei', { status: 404 }));
    expect((await request('/assets/sumiu.js')).status).toBe(404);
    fetchMock.mockResolvedValueOnce(text('segredo', { headers: { 'Cache-Control': 'private, no-store' } }));
    await request('/assets/privado.js');
    expect(await assetEntries()).toEqual([]);
  });

  it(`o cache de /assets/ fica limitado às entradas mais recentes`, async () => {
    for (let i = 0; i < 62; i++) await request(`/assets/chunk-${i}.js`);
    const entries = await assetEntries();
    expect(entries).toHaveLength(60);
    expect(entries[0]).toBe(`${ORIGIN}/assets/chunk-2.js`);
    expect(entries.at(-1)).toBe(`${ORIGIN}/assets/chunk-61.js`);
  });

  it('navegação: rede primeiro, e sem rede abre a última página guardada', async () => {
    const online = await request('/?aba=contas', { mode: 'navigate' });
    expect(await online.text()).toBe(`rede: ${ORIGIN}/?aba=contas`);
    expect(await shellEntries()).toEqual([`${ORIGIN}/`]);

    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const offline = await request('/outra-rota', { mode: 'navigate' });
    expect(await offline.text()).toBe(`rede: ${ORIGIN}/?aba=contas`);
  });

  it('navegação sem rede e sem página guardada: o erro de rede segue para o navegador', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(request('/', { mode: 'navigate' })).rejects.toThrow('Failed to fetch');
  });

  it('outros arquivos da mesma origem: rede primeiro, com o cache de reserva', async () => {
    await request('/icons/icon-192.png');
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const offline = await request('/icons/icon-192.png');
    expect(await offline.text()).toBe(`rede: ${ORIGIN}/icons/icon-192.png`);
  });
});
