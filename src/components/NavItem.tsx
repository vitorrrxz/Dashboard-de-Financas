interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  badge?: number;
  badgeColor?: string;
  onClick: () => void;
  isSubItem?: boolean;
  /** Barra superior (telas grandes): item compacto numa linha, em vez do item de largura cheia da barra lateral. */
  horizontal?: boolean;
}

export function NavItem({ icon, label, active, badge, badgeColor, onClick, isSubItem, horizontal }: NavItemProps) {
  const badgeEl = badge !== undefined && (
    <span className={`text-[10px] font-bold rounded-full ${horizontal ? 'px-1.5 py-0.5' : 'px-2 py-0.5'}`}
      style={{ backgroundColor: badgeColor || 'var(--fg-10)', color: badgeColor ? '#fff' : 'inherit' }}>
      {badge}
    </span>
  );

  if (horizontal) {
    return (
      <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined}
        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm whitespace-nowrap transition-all ${
          active ? 'bg-white/10 text-white shadow-sm' : 'text-textMuted hover:bg-white/5 hover:text-white'
        }`}>
        <span className={active ? 'text-primary' : ''}>{icon}</span>
        <span className="font-medium">{label}</span>
        {badgeEl}
      </button>
    );
  }

  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined}
      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all ${
        active ? 'bg-white/10 text-white shadow-sm' : 'text-textMuted hover:bg-white/5 hover:text-white'
      } ${isSubItem ? 'text-sm py-2' : ''}`}>
      <div className="flex items-center gap-3">
        <span className={active ? 'text-primary' : ''}>{icon}</span>
        <span className="font-medium">{label}</span>
      </div>
      {badgeEl}
    </button>
  );
}
