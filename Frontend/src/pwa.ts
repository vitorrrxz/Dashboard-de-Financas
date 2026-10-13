/**
 * FIN-082 — registra o service worker (`public/sw.js`), que deixa o app instalável e abre a casca
 * sem conexão. Só no build de produção: no `npm run dev`, um cache de arquivos atrapalharia o
 * recarregamento automático do Vite. O registro espera o `load`, para não disputar banda com a
 * primeira carga da página, e uma falha só vai para o console — o app funciona sem ele.
 */
export function registerServiceWorker(enabled: boolean = import.meta.env.PROD): void {
  if (!enabled || !('serviceWorker' in navigator)) return;
  const container = navigator.serviceWorker;
  window.addEventListener('load', () => {
    container.register('/sw.js').catch(err => {
      console.error('Falha ao registrar o service worker:', err);
    });
  }, { once: true });
}
