// Esconder valores: com o olho fechado, todo valor em dinheiro aparece como "R$ ••••" (para usar o
// app em público ou mostrar a tela a alguém). Os formatadores (`formatBRL`, `formatMoney`) consultam
// a escolha na hora de formatar; ela fica no navegador (`localStorage`), como o tema.
export const HIDE_VALUES_STORAGE_KEY = 'finflow_hide_values';
/** O que aparece no lugar do número. */
export const HIDDEN_VALUE = '••••';

function readStored(): boolean {
  try {
    return window.localStorage.getItem(HIDE_VALUES_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

let hidden = typeof window === 'undefined' ? false : readStored();
const listeners = new Set<() => void>();

/** Se os valores estão escondidos agora. */
export function valuesHidden(): boolean {
  return hidden;
}

/** Esconde ou mostra os valores, guarda a escolha e avisa quem acompanha (`useHideValues`). */
export function setValuesHidden(next: boolean): void {
  hidden = next;
  try {
    window.localStorage.setItem(HIDE_VALUES_STORAGE_KEY, next ? '1' : '0');
  } catch {
    // Sem armazenamento (navegação privada restrita): vale só até recarregar a página.
  }
  listeners.forEach(listener => listener());
}

export function subscribeValuesHidden(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
