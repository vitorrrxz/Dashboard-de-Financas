// FIN-082 — service worker do FinFlow (PWA): deixa o app instalável e abre a "casca" (HTML, JS,
// CSS, ícones) mesmo sem conexão. NUNCA guarda dados financeiros: requisições à API, a outras
// origens e qualquer método que não seja GET passam direto, sem cache — os dados continuam só no
// servidor e na memória da página.
//
// Estratégias, por tipo de requisição:
// - navegação (abrir o app): rede primeiro, para pegar sempre a versão publicada; sem rede, a
//   última página guardada;
// - /assets/ (nomes com hash do Vite — o conteúdo de um nome nunca muda): cache primeiro, com
//   limite de entradas para os arquivos de versões antigas não se acumularem;
// - demais arquivos da mesma origem (ícones, manifesto): rede primeiro, com o cache de reserva.
// Mudou a lógica deste arquivo? Troque CACHE_VERSION: a ativação apaga os caches da versão antiga.

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `finflow-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `finflow-assets-${CACHE_VERSION}`;
const MAX_ASSET_ENTRIES = 60;
// Chave única da página: o app é uma SPA, e toda navegação recebe o mesmo HTML.
const SHELL_URL = '/';
const PRECACHE = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];

/** Arquivos de /assets/ citados no HTML (o JS e o CSS de entrada), para já entrarem na instalação. */
function assetsInHtml(html) {
  const found = new Set();
  for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)) found.add(match[1]);
  return [...found];
}

/** Só respostas de sucesso da própria origem, e nunca as marcadas `no-store`. */
function isCacheable(response) {
  if (!response || !response.ok) return false;
  if (response.type !== 'basic' && response.type !== 'default') return false;
  return !/no-store/i.test(response.headers.get('Cache-Control') || '');
}

/** Mantém no máximo `max` entradas, descartando as mais antigas (a ordem de `keys()` é a de inserção). */
async function trimCache(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) {
    await cache.put(request, response.clone());
    await trimCache(cache, MAX_ASSET_ENTRIES);
  }
  return response;
}

async function networkFirst(request, cacheKey = request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (isCacheable(response)) await cache.put(cacheKey, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(PRECACHE);
    const page = await shell.match(SHELL_URL);
    if (page) {
      const assets = await caches.open(ASSET_CACHE);
      await assets.addAll(assetsInHtml(await page.text()));
    }
    // Os arquivos têm hash e a página vem sempre da rede: a versão nova pode assumir na hora.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const current = new Set([SHELL_CACHE, ASSET_CACHE]);
    for (const key of await caches.keys()) {
      if (key.startsWith('finflow-') && !current.has(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // API em outra origem (o backend na porta 3001), CDN da Pluggy e fontes: o navegador resolve.
  if (url.origin !== self.location.origin) return;
  // API servida na mesma origem (atrás de um proxy): também nunca passa pelo cache.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_URL));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});
