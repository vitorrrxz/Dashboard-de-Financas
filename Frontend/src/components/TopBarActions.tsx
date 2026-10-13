import { lazy, Suspense, useEffect, useState } from 'react';
import { Building2, ChevronDown, LogOut, Loader2, Trash2, Upload, Wallet } from 'lucide-react';

const PluggyConnectButton = lazy(() => import('./PluggyConnectButton').then(m => ({ default: m.PluggyConnectButton })));

interface TopBarActionsProps {
  user: { name: string; email: string } | null;
  token: string;
  onLogout: () => void;
  onManageAccounts: () => void;
  onShowImport: () => void;
  onPluggySyncComplete: () => void;
  hasTransactions: boolean;
  onClearTransactions: () => void;
}

const BUTTON = 'flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors';

/**
 * Ações do rodapé da barra lateral (celular/tablet), visíveis na barra superior das telas
 * grandes. O painel da Pluggy fica sempre montado — só escondido quando fechado —, porque a
 * sincronização automática (FIN-107) sai quando ele monta, ao abrir o app.
 */
export function TopBarActions({
  user, token, onLogout, onManageAccounts, onShowImport, onPluggySyncComplete, hasTransactions, onClearTransactions,
}: TopBarActionsProps) {
  const [openPanel, setOpenPanel] = useState<'bank' | 'user' | null>(null);
  const toggle = (panel: 'bank' | 'user') => setOpenPanel(p => (p === panel ? null : panel));
  const close = () => setOpenPanel(null);

  useEffect(() => {
    if (!openPanel) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenPanel(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openPanel]);

  return (
    <div className="flex items-center gap-1 shrink-0">
      {openPanel && <div className="fixed inset-0 z-30" onClick={close} aria-hidden="true" />}

      <button type="button" onClick={onShowImport} aria-label="Importação Manual" title="Importação Manual"
        className={`${BUTTON} text-textMuted hover:text-white hover:bg-white/5`}>
        <Upload size={16} aria-hidden="true" /> <span className="hidden xl:inline">Importar</span>
      </button>

      <div className="relative">
        <button type="button" onClick={() => toggle('bank')} aria-expanded={openPanel === 'bank'} aria-controls="topbar-bank-panel"
          aria-label="Open Finance: conectar banco" title="Open Finance: conectar banco"
          className={`${BUTTON} ${openPanel === 'bank' ? 'bg-white/10 text-white' : 'text-textMuted hover:text-white hover:bg-white/5'}`}>
          <Building2 size={16} aria-hidden="true" /> <span className="hidden xl:inline">Open Finance</span>
        </button>
        <div id="topbar-bank-panel" hidden={openPanel !== 'bank'}
          className="absolute right-0 top-full mt-2 w-80 max-w-[90vw] z-40 shadow-2xl rounded-2xl"
          style={{ backgroundColor: 'var(--color-background)' }}>
          <Suspense fallback={
            <div role="status" className="w-full py-3 flex items-center justify-center gap-2 text-xs text-textMuted">
              <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Carregando...
            </div>
          }>
            <PluggyConnectButton token={token} onSyncComplete={onPluggySyncComplete} />
          </Suspense>
        </div>
      </div>

      {hasTransactions && (
        <button type="button" onClick={onClearTransactions} aria-label="Limpar Transações" title="Limpar Transações"
          className={`${BUTTON} text-red-400 hover:bg-red-500/10`}>
          <Trash2 size={16} aria-hidden="true" /> <span className="hidden xl:inline">Limpar</span>
        </button>
      )}

      <div className="relative ml-2">
        <button type="button" onClick={() => toggle('user')} aria-expanded={openPanel === 'user'} aria-haspopup="true"
          aria-label="Menu do usuário"
          className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-white/5 transition-colors text-white max-w-[200px]">
          <span aria-hidden="true" className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-on-accent"
            style={{ background: 'linear-gradient(135deg,var(--color-primary),var(--color-secondary))' }}>
            {(user?.name ?? '?').charAt(0).toUpperCase()}
          </span>
          <span className="text-sm font-medium truncate hidden xl:inline">{user?.name}</span>
          <ChevronDown size={16} className="text-textMuted shrink-0" aria-hidden="true" />
        </button>
        {openPanel === 'user' && (
          <div className="absolute right-0 top-full mt-2 w-64 glass-card rounded-2xl p-3 z-40 shadow-2xl space-y-2">
            <div className="px-2 py-1.5">
              <p className="text-sm font-semibold text-white truncate">{user?.name}</p>
              <p className="text-xs text-textMuted truncate">{user?.email}</p>
            </div>
            <button type="button" onClick={() => { onManageAccounts(); close(); }}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-on-accent flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg,var(--color-primary),var(--color-secondary))' }}>
              <Wallet size={15} aria-hidden="true" /> Gerenciar Contas
            </button>
            <button type="button" onClick={() => { close(); onLogout(); }}
              className="w-full py-2.5 rounded-xl border border-red-500/10 text-xs font-medium text-red-400 hover:bg-red-500/10 flex items-center justify-center gap-2">
              <LogOut size={14} aria-hidden="true" /> Sair
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
