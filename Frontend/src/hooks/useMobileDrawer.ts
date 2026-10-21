import { useEffect, useRef, type RefObject, type TouchEvent } from 'react';
import { useMediaQuery } from './useMediaQuery';

/** Mesma largura do breakpoint `md` do Tailwind: dali para cima o menu é a barra lateral fixa. */
export const DESKTOP_QUERY = '(min-width: 768px)';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Deslize mínimo, em pixels, para a esquerda que fecha a gaveta. */
const SWIPE_CLOSE_PX = 60;

interface MobileDrawerOptions {
  open: boolean;
  onClose: () => void;
  /** A gaveta: o foco fica preso aqui dentro enquanto ela está aberta numa tela pequena. */
  containerRef: RefObject<HTMLElement | null>;
  /** Recebe o foco ao abrir (o botão de fechar); sem ele, o primeiro item focável da gaveta. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Recebe o foco de volta ao fechar (o botão que abriu). */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * FIN-081 — o menu lateral como gaveta nas telas pequenas, com o comportamento de um diálogo
 * modal: ao abrir, o foco entra nela; Tab e Shift+Tab circulam só lá dentro; Esc fecha; ao fechar,
 * o foco volta ao botão que a abriu. Deslizar para a esquerda também fecha. Da largura `md` para
 * cima nada disso vale — é a barra lateral de sempre —, e a gaveta que estava aberta quando a
 * janela alargou é fechada, para não reabrir sozinha quando ela voltar a estreitar.
 *
 * Devolve `modal` (aberta numa tela pequena: aplicar `role="dialog"` e `aria-modal`), `hidden`
 * (fechada numa tela pequena: fora da tela, deve ficar `inert`, longe do teclado e dos leitores
 * de tela) e os tratadores de toque do deslize.
 */
export function useMobileDrawer({ open, onClose, containerRef, initialFocusRef, returnFocusRef }: MobileDrawerOptions) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const modal = open && !isDesktop;

  // A função de fechar muda a cada renderização do App; guardada numa ref, ela não reinicia os
  // efeitos abaixo (o que devolveria o foco ao botão de fechar a cada tecla digitada na busca).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!modal) return;
    const container = containerRef.current;
    const opener = returnFocusRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    (initialFocusRef?.current ?? container?.querySelector<HTMLElement>(FOCUSABLE))?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !container) return;
      const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (!container.contains(current)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && current === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      opener?.focus();
    };
  }, [modal, containerRef, initialFocusRef, returnFocusRef]);

  useEffect(() => {
    if (!open || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(DESKTOP_QUERY);
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) onCloseRef.current();
    };
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [open]);

  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swipeHandlers = {
    onTouchStart: (e: TouchEvent) => {
      const touch = e.touches[0];
      touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    },
    onTouchEnd: (e: TouchEvent) => {
      const start = touchStart.current;
      touchStart.current = null;
      const touch = e.changedTouches[0];
      if (!modal || !start || !touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      // Só um gesto predominantemente horizontal: rolar a lista do menu não pode fechá-lo.
      if (dx <= -SWIPE_CLOSE_PX && Math.abs(dx) > Math.abs(dy)) onCloseRef.current();
    },
  };

  return { modal, hidden: !open && !isDesktop, swipeHandlers };
}
