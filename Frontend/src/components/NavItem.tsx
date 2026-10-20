interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  /** Só para uma fila que pede ação (dívidas vencidas, orçamento estourado) — nunca um total. */
  badge?: number;
  onClick: () => void;
  isSubItem?: boolean;
}

export function NavItem({ icon, label, active, badge, onClick, isSubItem }: NavItemProps) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined}
      className={`w-full h-8 flex items-center justify-between px-2.5 rounded-md text-sm transition-colors ${
        active ? 'bg-white/[0.07] text-white' : 'text-textMuted hover:bg-white/[0.04] hover:text-white'
      } ${isSubItem ? 'pl-8' : ''}`}>
      <span className="flex items-center gap-2.5">
        {!isSubItem && <span className="shrink-0" aria-hidden="true">{icon}</span>}
        {label}
      </span>
      {badge !== undefined && (
        <span className="min-w-5 h-5 px-1.5 rounded-full text-xs font-medium flex items-center justify-center"
          style={{ backgroundColor: 'var(--color-red-500)', color: '#fff' }}>
          {badge}
        </span>
      )}
    </button>
  );
}
