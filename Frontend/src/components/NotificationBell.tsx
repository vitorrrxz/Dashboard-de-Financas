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

/** Ícone de cada tipo, em cinza; só a dívida vencida — o que pede ação já — leva o vermelho. */
const TYPE_META: Record<NotificationType, { icon: typeof Bell; urgent?: boolean }> = {
  debt_overdue:     { icon: AlertCircle, urgent: true },
  debt_due:         { icon: Clock },
  bill_due:         { icon: CreditCard },
  unusual_spending: { icon: TrendingUp },
};

/** Ícone de um tipo — com fallback, porque um tipo novo vindo da API não pode quebrar o header. */
function typeMeta(type: string) {
  return TYPE_META[type as NotificationType] ?? { icon: Bell };
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
        className="relative p-2 rounded-md hover:bg-white/[0.06] transition-colors text-textMuted hover:text-white">
        <Bell size={16} aria-hidden="true"/>
        {unreadCount > 0 && (
          <span aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-xs font-medium flex items-center justify-center border-2 border-background" style={{ color: '#fff' }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden="true"/>
          <div className="absolute right-0 top-full mt-2 w-80 max-w-[90vw] panel rounded-2xl p-3 z-40 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
            <div className="flex items-center justify-between gap-2 px-2 py-1.5">
              <p className="text-sm font-medium text-white">Notificações</p>
              <button type="button" onClick={onMarkAllRead} disabled={unreadCount === 0}
                className="text-xs text-textMuted hover:text-white disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed">
                Marcar todas como lidas
              </button>
            </div>

            {notifications.length === 0 ? (
              <p className="text-sm text-textMuted px-2 py-6 text-center">Nenhuma notificação.</p>
            ) : (
              <ul className="space-y-1 max-h-80 overflow-y-auto">
                {notifications.map(n => {
                  const { icon: Icon, urgent } = typeMeta(n.type);
                  return (
                    <li key={n.id}>
                      <button type="button" onClick={() => { onSelect(n); setOpen(false); }}
                        className={`w-full text-left px-2 py-2 rounded-lg hover:bg-white/5 flex items-start gap-2.5 ${n.read ? 'opacity-60' : ''}`}>
                        <Icon size={15} className={`shrink-0 mt-0.5 ${urgent ? 'text-red-400' : 'text-textMuted'}`} aria-hidden="true"/>
                        <span className="min-w-0 flex-1">
                          <span className={`block text-sm truncate ${n.read ? 'text-textMuted' : 'text-white font-medium'}`}>{n.title}</span>
                          <span className="block text-xs text-textMuted mt-0.5">{n.message}</span>
                          <span className="block text-xs text-textMuted opacity-70 mt-1">{formatRelativeTime(n.createdAt)}</span>
                        </span>
                        {!n.read && (
                          <span className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: 'var(--color-accent)' }}>
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
