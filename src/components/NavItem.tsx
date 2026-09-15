export function NavItem({ icon, label, active, badge, badgeColor, onClick, isSubItem }: { icon: React.ReactNode; label: string; active: boolean; badge?: number; badgeColor?: string; onClick: () => void; isSubItem?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined}
      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all ${
        active ? 'bg-white/10 text-white shadow-sm' : 'text-textMuted hover:bg-white/5 hover:text-white'
      } ${isSubItem ? 'text-sm py-2' : ''}`}>
      <div className="flex items-center gap-3">
        <span className={active ? 'text-primary' : ''}>{icon}</span>
        <span className="font-medium">{label}</span>
      </div>
      {badge !== undefined && (
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: badgeColor || 'var(--fg-10)', color: badgeColor ? '#fff' : 'inherit' }}>
          {badge}
        </span>
      )}
    </button>
  );
}
