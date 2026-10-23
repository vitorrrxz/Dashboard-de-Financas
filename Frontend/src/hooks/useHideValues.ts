import { useSyncExternalStore } from 'react';
import { setValuesHidden, subscribeValuesHidden, valuesHidden } from '../utils/privacy';

/**
 * Esconder valores (botão do olho no topo): o estado e a troca. Quem usa o hook redesenha ao trocar —
 * o App, e com ele as telas, que formatam os valores de novo com a escolha nova.
 */
export function useHideValues(): [boolean, (hidden: boolean) => void] {
  const hidden = useSyncExternalStore(subscribeValuesHidden, valuesHidden, () => false);
  return [hidden, setValuesHidden];
}
