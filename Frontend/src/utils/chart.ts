/**
 * Marcas do eixo Y em passos redondos (1, 2, 2,5 ou 5 × 10ⁿ), sempre com o zero, e com uma marca
 * além do maior valor (e do menor, se negativo) para a barra não encostar na borda do gráfico.
 */
export function niceTicks(values: number[], count = 4): number[] {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const raw = (max - min || 1) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw)!;
  const hi = max > 0 ? (Math.floor(max / step) + 1) * step : 0;
  const lo = min < 0 ? (Math.ceil(min / step) - 1) * step : 0;
  return Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => +(lo + i * step).toFixed(10));
}
