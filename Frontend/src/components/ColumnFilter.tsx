import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
  /** Cor do ponto antes do rótulo (a cor da categoria). */
  dot?: string;
}

export interface ColumnFilterProps {
  label: string;
  options: FilterOption[];
  /** `null` = todas as opções. */
  value: string | null;
  onChange: (value: string | null) => void;
  allLabel?: string;
}

const PANEL_WIDTH = 256;

/**
 * Filtro no cabeçalho de uma coluna: o título vira um botão que abre a lista de opções, de
 * escolha única. O painel é `fixed` (posicionado pelo botão) porque as tabelas rolam de lado
 * num contêiner com overflow, que cortaria um painel `absolute`. Fecha com Esc, clique fora ou
 * rolagem da página — a rolagem da própria lista de opções não conta.
 */
export function ColumnFilter({ label, options, value, onChange, allLabel = 'Todas' }: ColumnFilterProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const open = position !== null;
  const selected = options.find(o => o.value === value);

  const close = () => setPosition(null);
  const toggle = () => {
    if (open) return close();
    const rect = buttonRef.current!.getBoundingClientRect();
    setPosition({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8)) });
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); buttonRef.current?.focus(); } };
    const onScroll = (e: Event) => { if (!panelRef.current?.contains(e.target as Node)) close(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const choose = (next: string | null) => { onChange(next); close(); };

  return (
    <>
      <button ref={buttonRef} type="button" onClick={toggle} aria-expanded={open} aria-haspopup="true"
        className={`inline-flex items-center gap-1 rounded transition-colors hover:text-white ${selected ? 'text-white font-medium' : ''}`}>
        {selected?.dot && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: selected.dot }} aria-hidden="true" />}
        {selected ? selected.label : label}
        <ChevronDown size={12} aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        {selected && <span className="sr-only">(filtro de {label} ativo)</span>}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} aria-hidden="true" />
          <div ref={panelRef} role="group" aria-label={`Filtrar por ${label.toLowerCase()}`}
            className="fixed z-50 panel rounded-xl p-1 max-h-80 overflow-y-auto overscroll-contain shadow-[0_8px_24px_rgba(0,0,0,0.12)] text-left font-normal"
            style={{ top: position.top, left: position.left, width: PANEL_WIDTH }}>
            {[{ value: null, label: allLabel } as { value: string | null; label: string; count?: number; dot?: string }, ...options].map(o => {
              const active = o.value === value;
              return (
                <button key={o.value ?? '__all'} type="button" aria-pressed={active} onClick={() => choose(o.value)}
                  className={`w-full h-8 px-2.5 rounded-md text-sm flex items-center gap-2 transition-colors hover:bg-white/[0.06] ${active ? 'text-white font-medium' : 'text-white'}`}>
                  {o.dot && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: o.dot }} aria-hidden="true" />}
                  <span className="truncate flex-1 text-left">{o.label}</span>
                  {o.count !== undefined && <span className="text-xs text-textMuted">{o.count}</span>}
                  <Check size={14} aria-hidden="true" className={active ? 'text-white' : 'invisible'} />
                </button>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
