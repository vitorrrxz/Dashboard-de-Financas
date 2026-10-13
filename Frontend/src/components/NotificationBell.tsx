import { useEffect, useState } from 'react';
import { AlertCircle, Bell, Clock, CreditCard, TrendingUp } from 'lucide-react';
import type { AppNotification, NotificationType } from '../types';
import { formatRelativeTime } from '../utils/dates';

interface NotificationBellProps {
  notifications: AppNotification[];
  unreadCount: number;
  /** Clique numa notificação — o App marca como lida e abre a aba relacionada. */
  onSelect: (notification: AppNotification) => void;
  onMarkAllRead: () => void;
}

const TYPE_META: Record<NotificationType, { icon: typeof Bell; color: string }> = {
  debt_overdue:     { icon: AlertCircle, color: '#f87171' },
  debt_due:         { icon: Clock,       color: '#fbbf24' },
  bill_due:         { icon: CreditCard,  color: '#ec4899' },
  unusual_spending: { icon: TrendingUp,  color: '#a78bfa' },
};

/** Ícone e cor de um tipo — com fallback, porque um tipo novo vindo da API não pode quebrar o header. */
function typeMeta(type: string) {
  return TYPE_META[type as NotificationType] ?? { icon: Bell, color: '#9ca3af' };
}

/**
 * Sino do header com a central de notificações (FIN-066). Substitui o dropdown de FIN-039,
 * que só listava as dívidas vencidas calculadas no navegador: agora consome as notificações
 * persistidas no servidor (FIN-065), com estado de lida e contador de não lidas.
 */
export function NotificationBell({ notifications, unreadCount, onSelect, onMarkAllRead }: NotificationBellProps) {
  const [open, setOpen] = useState(false);

  // Esc fecha o painel — o mesmo atalho de qualquer menu suspenso.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        aria-label={unreadCount > 0 ? `Notificações: ${unreadCount} não lida(s)` : 'Notificações'}
        aria-expanded={open} aria-haspopup="true"
        className="relative p-2 rounded-full hover:bg-white/5 transition-colors">
        <Bell size={20} className="text-textMuted" aria-hidden="true"/>
        {unreadCount > 0 && (
          <span aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-on-accent text-[10px] font-bold flex items-center justify-center border-2 border-background">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden="true"/>
          <div className="absolute right-0 top-full mt-2 w-80 max-w-[90vw] glass-card rounded-2xl p-3 z-40 shadow-2xl">
            <div className="flex items-center justify-between gap-2 px-2 py-1.5">
              <p className="text-xs font-semibold text-textMuted uppercase tracking-wide">Notificações</p>
              <button type="button" onClick={onMarkAllRead} disabled={unreadCount === 0}
                className="text-xs text-primary hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed">
                Marcar todas como lidas
              </button>
            </div>

            {notifications.length === 0 ? (
              <p className="text-sm text-textMuted px-2 py-6 text-center">Nenhuma notificação.</p>
            ) : (
              <ul className="space-y-1 max-h-80 overflow-y-auto">
                {notifications.map(n => {
                  const { icon: Icon, color } = typeMeta(n.type);
                  return (
                    <li key={n.id}>
                      <button type="button" onClick={() => { onSelect(n); setOpen(false); }}
                        className={`w-full text-left px-2 py-2 rounded-lg hover:bg-white/5 flex items-start gap-2.5 ${n.read ? 'opacity-60' : ''}`}>
                        <Icon size={15} className="shrink-0 mt-0.5" style={{ color }} aria-hidden="true"/>
                        <span className="min-w-0 flex-1">
                          <span className={`block text-sm truncate ${n.read ? 'text-textMuted' : 'text-white font-medium'}`}>{n.title}</span>
                          <span className="block text-xs text-textMuted mt-0.5">{n.message}</span>
                          <span className="block text-[10px] text-textMuted opacity-70 mt-1">{formatRelativeTime(n.createdAt)}</span>
                        </span>
                        {!n.read && (
                          <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5">
                            <span className="sr-only">Não lida</span>
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
