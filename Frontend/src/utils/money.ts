/**
 * Utilitários de conversão entre reais (número decimal usado na UI/formulários) e
 * centavos (inteiro usado no banco de dados e na API) — ver FIN-015 em
 * docs/BACKLOG_DETAIL.md.
 *
 * Valores monetários eram armazenados como `Float`, sujeitos a erro de arredondamento
 * de ponto flutuante em somas repetidas (ex. `0.1 + 0.2 !== 0.3`). Guardar centavos como
 * `Int` elimina esse risco. A conversão acontece apenas na borda: o banco e a API
 * trafegam em centavos; o frontend converte para reais ao receber e de volta para
 * centavos ao enviar, para que toda a lógica de UI/cálculo continue em reais (mais
 * legível para exibição) sem herdar o problema de ponto flutuante na persistência.
 */

/** Converte um valor em reais (ex. 150.5) para centavos inteiros (ex. 15050). */
export function toCents(reais: number): number {
  return Math.round(reais * 100);
}

/** Converte um valor em centavos inteiros (ex. 15050) para reais (ex. 150.5). */
export function toReais(cents: number): number {
  return cents / 100;
}

/**
 * Aplica `toCents` a um valor que pode ser `null`/`undefined` (campos monetários
 * opcionais como `Account.limit`/`Account.pendingBill`/`Debt.interestRate` não devem
 * virar `0` quando ausentes).
 */
export function toCentsOrNull(reais: number | null | undefined): number | null | undefined {
  if (reais === null || reais === undefined) return reais;
  return toCents(reais);
}

/** Aplica `toReais` a um valor que pode ser `null`/`undefined`. */
export function toReaisOrNull(cents: number | null | undefined): number | null | undefined {
  if (cents === null || cents === undefined) return cents;
  return toReais(cents);
}

/**
 * Formata um valor em reais para exibição ("R$ 1.234,56"), sempre em módulo — o sinal,
 * quando importa, fica a cargo de quem exibe (ver `MonthTotal`). Limita a duas casas: sem
 * `maximumFractionDigits`, o padrão do `toLocaleString` é três, e um resíduo de ponto
 * flutuante apareceria como "R$ 0,300".
 */
export function formatBRL(value: number): string {
  return `R$ ${Math.abs(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
