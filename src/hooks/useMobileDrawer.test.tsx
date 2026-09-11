// FIN-081 — gaveta do menu em telas pequenas: foco, Esc, Tab circular, deslize e largura de tela.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useMobileDrawer } from './useMobileDrawer';
import { useMediaQuery } from './useMediaQuery';

const originalMatchMedia = window.matchMedia;

/** `matchMedia` controlável: `setDesktop` muda o resultado e avisa quem está ouvindo. */
function mockMatchMedia(desktop: boolean) {
  let matches = desktop;
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  window.matchMedia = vi.fn((query: string) => ({
    get matches() { return matches; },
    media: query,
    addEventListener: (_type: string, listener: (e: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (e: MediaQueryListEvent) => void) => listeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
  return {
    setDesktop(value: boolean) {
      matches = value;
      act(() => listeners.forEach(listener => listener({ matches: value } as MediaQueryListEvent)));
    },
  };
}

function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = () => { onClose(); setOpen(false); };
  const drawer = useMobileDrawer({ open, onClose: close, containerRef: container, initialFocusRef: closeButton, returnFocusRef: opener });
  return (
    <>
      <button ref={opener} onClick={() => setOpen(true)}>Abrir menu</button>
      <div ref={container} data-testid="drawer" data-modal={drawer.modal} data-hidden={drawer.hidden} {...drawer.swipeHandlers}>
        <button ref={closeButton} onClick={close}>Fechar menu</button>
        <a href="#primeiro">Primeiro link</a>
        <a href="#ultimo">Último link</a>
      </div>
      <button>Fora da gaveta</button>
    </>
  );
}

function openDrawer() {
  const onClose = vi.fn();
  render(<Harness onClose={onClose} />);
  fireEvent.click(screen.getByText('Abrir menu'));
  return onClose;
}

describe('useMobileDrawer (FIN-081)', () => {
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('em tela pequena: abre com foco no botão de fechar; Esc fecha e devolve o foco a quem abriu', () => {
    mockMatchMedia(false);
    const onClose = openDrawer();
    expect(screen.getByTestId('drawer')).toHaveAttribute('data-modal', 'true');
    expect(screen.getByText('Fechar menu')).toHaveFocus();

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('drawer')).toHaveAttribute('data-modal', 'false');
    expect(screen.getByText('Abrir menu')).toHaveFocus();
  });

  it('Tab circula dentro da gaveta: do último vai ao primeiro, e Shift+Tab do primeiro vai ao último', () => {
    mockMatchMedia(false);
    openDrawer();
    const first = screen.getByText('Fechar menu');
    const last = screen.getByText('Último link');

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    // No meio da lista, o navegador segue com o Tab normal — o hook não interfere.
    const middle = screen.getByText('Primeiro link');
    middle.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    middle.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('foco que escapou da gaveta volta para dentro no próximo Tab', () => {
    mockMatchMedia(false);
    openDrawer();
    const outside = screen.getByText('Fora da gaveta');
    outside.focus();
    fireEvent.keyDown(outside, { key: 'Tab' });
    expect(screen.getByText('Fechar menu')).toHaveFocus();
  });

  it('fechada em tela pequena: marcada como escondida, sem armadilha de foco nem Esc', () => {
    mockMatchMedia(false);
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    expect(screen.getByTestId('drawer')).toHaveAttribute('data-hidden', 'true');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('em tela larga é a barra lateral de sempre: nem escondida, nem modal, e Esc não fecha', () => {
    mockMatchMedia(true);
    const onClose = openDrawer();
    const drawer = screen.getByTestId('drawer');
    expect(drawer).toHaveAttribute('data-modal', 'false');
    expect(drawer).toHaveAttribute('data-hidden', 'false');
    expect(screen.getByText('Fechar menu')).not.toHaveFocus();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('alargar a janela com a gaveta aberta a fecha', () => {
    const media = mockMatchMedia(false);
    const onClose = openDrawer();
    media.setDesktop(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('drawer')).toHaveAttribute('data-hidden', 'false');
  });

  it('deslizar para a esquerda fecha; deslize curto ou vertical não', () => {
    mockMatchMedia(false);
    const onClose = openDrawer();
    const drawer = screen.getByTestId('drawer');
    const swipe = (from: [number, number], to: [number, number]) => {
      fireEvent.touchStart(drawer, { touches: [{ clientX: from[0], clientY: from[1] }] });
      fireEvent.touchEnd(drawer, { changedTouches: [{ clientX: to[0], clientY: to[1] }] });
    };

    swipe([200, 100], [170, 100]);
    swipe([200, 100], [120, 300]);
    expect(onClose).not.toHaveBeenCalled();
    swipe([200, 100], [120, 110]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('useMediaQuery', () => {
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('acompanha a mudança da media query', () => {
    const media = mockMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(false);
    media.setDesktop(true);
    expect(result.current).toBe(true);
  });

  it('sem matchMedia no ambiente, vale false em vez de quebrar', () => {
    // @ts-expect-error — simula um ambiente sem a API
    delete window.matchMedia;
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(false);
  });
});
