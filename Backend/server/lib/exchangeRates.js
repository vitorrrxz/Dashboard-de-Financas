import './env.js';
import { BASE_CURRENCY, CURRENCY_CODE_PATTERN } from './money.js';

/* -------------------------------------------------------------------------- */
/*                      CÂMBIO PARA EXIBIÇÃO (FIN-075)                        */
/* -------------------------------------------------------------------------- */
// Os totais do app são exibidos em real; contas e posições em outra moeda entram neles
// convertidas pela cotação do dia. Provedor: Frankfurter (cotações de referência do Banco
// Central Europeu) — gratuito, sem chave de acesso, de código aberto e hospedável por conta
// própria. A avaliação dos provedores está em FIN-075 (docs/BACKLOG_DETAIL.md);
// `EXCHANGE_RATES_URL` aponta para outra instância sem mudar código.
const EXCHANGE_RATES_URL = (process.env.EXCHANGE_RATES_URL || 'https://api.frankfurter.dev/v1').replace(/\/+$/, '');
// O BCE publica uma cotação por dia útil: com 12 h de cache, o servidor consulta o provedor no
// máximo duas vezes por dia, não importa quantos usuários abram o app.
const EXCHANGE_RATES_TTL_MS = 12 * 60 * 60 * 1000;
// Depois de uma falha, espera antes de tentar de novo — com o provedor fora do ar, cada
// carregamento do app esperaria o timeout inteiro.
const EXCHANGE_RATES_RETRY_MS = 5 * 60 * 1000;
const EXCHANGE_RATES_TIMEOUT_MS = 5000;

/**
 * Valida a resposta do provedor (`{ base, date, rates }`) e a inverte para "quantos reais vale
 * 1 unidade de cada moeda" — o provedor responde quantas unidades de cada moeda valem 1 real.
 * Cada cotação que não seja um número positivo é descartada (um 0 viraria divisão por zero).
 * Devolve `null` quando a resposta não tem o formato esperado.
 */
export function parseProviderRates(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { base, date, rates } = body;
  if (base !== BASE_CURRENCY || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!rates || typeof rates !== 'object' || Array.isArray(rates)) return null;
  const perUnit = {};
  for (const [code, perReal] of Object.entries(rates)) {
    if (CURRENCY_CODE_PATTERN.test(code) && typeof perReal === 'number' && Number.isFinite(perReal) && perReal > 0) {
      perUnit[code] = 1 / perReal;
    }
  }
  return { date, rates: perUnit };
}

/**
 * Cache das cotações: validade de `ttlMs`, uma única consulta em andamento por vez e espera
 * de `retryMs` depois de uma falha. Se a atualização falha e há cotação anterior, serve a
 * anterior marcada como `stale` — o app continua convertendo e a tela avisa que a cotação é
 * antiga. Sem cotação nenhuma, a falha sobe para quem chamou. `now` é injetável nos testes.
 */
export function createExchangeRateCache({ fetchRates, ttlMs, retryMs, now = () => Date.now() }) {
  let cached = null; // { date, rates, fetchedAt }
  let lastFailureAt = -Infinity;
  let inflight = null;

  const serve = (entry, stale) => ({ date: entry.date, rates: entry.rates, stale });

  return async function getRates() {
    if (cached && now() - cached.fetchedAt < ttlMs) return serve(cached, false);
    if (now() - lastFailureAt < retryMs) {
      if (cached) return serve(cached, true);
      throw new Error('Cotações indisponíveis; nova tentativa em instantes.');
    }
    if (!inflight) {
      // `Promise.resolve().then` torna assíncrona até uma exceção síncrona de `fetchRates`,
      // para ela passar pelo mesmo caminho de falha.
      const attempt = Promise.resolve()
        .then(() => fetchRates())
        .then(
          fresh => {
            cached = { date: fresh.date, rates: fresh.rates, fetchedAt: now() };
            return cached;
          },
          err => {
            lastFailureAt = now();
            throw err;
          }
        );
      inflight = attempt;
      // Libera a vaga só depois de a tentativa terminar, e só se ela ainda for a atual.
      attempt.finally(() => { if (inflight === attempt) inflight = null; }).catch(() => {});
    }
    try {
      return serve(await inflight, false);
    } catch (err) {
      if (cached) return serve(cached, true);
      throw err;
    }
  };
}

/** Consulta o provedor de câmbio (com timeout) e devolve as cotações já validadas. */
async function fetchProviderRates() {
  const res = await fetch(`${EXCHANGE_RATES_URL}/latest?base=${BASE_CURRENCY}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(EXCHANGE_RATES_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Provedor de câmbio respondeu HTTP ${res.status}.`);
  const parsed = parseProviderRates(await res.json().catch(() => null));
  if (!parsed) throw new Error('Provedor de câmbio respondeu num formato inesperado.');
  return parsed;
}

export const getExchangeRates = createExchangeRateCache({
  fetchRates: fetchProviderRates,
  ttlMs: EXCHANGE_RATES_TTL_MS,
  retryMs: EXCHANGE_RATES_RETRY_MS,
});
