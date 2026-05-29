import { useState, useCallback } from 'react';
import { Link2, RefreshCw, CheckCircle2, Loader2, Building2 } from 'lucide-react';

interface PluggyConnectData {
  item: {
    id: string;
  };
}

interface PluggyConnectConfig {
  connectToken: string;
  includeSandbox?: boolean;
  onSuccess: (data: PluggyConnectData) => void | Promise<void>;
  onError: (err: Error | Record<string, unknown>) => void;
  onClose: () => void;
}

interface PluggyConnectInstance {
  init: () => void;
}

declare global {
  interface Window {
    PluggyConnect?: new (config: PluggyConnectConfig) => PluggyConnectInstance;
  }
}

interface PluggyConnectButtonProps {
  token: string;
  onSyncComplete: () => void;
}

interface ConnectedItem {
  itemId: string;
  providerName: string;
}

export function PluggyConnectButton({ token, onSyncComplete }: PluggyConnectButtonProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'connected' | 'syncing' | 'done'>('idle');
  const [connectedItem, setConnectedItem] = useState<ConnectedItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAPI = useCallback(async (endpoint: string, method = 'POST', body?: unknown) => {
    const res = await fetch(`http://localhost:3001${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Erro na API');
    }
    return res.json();
  }, [token]);

  const handleConnect = async () => {
    setStatus('loading');
    setError(null);

    try {
      const { accessToken } = await fetchAPI('/api/pluggy/connect-token');
      if (!accessToken) throw new Error('Token de conexão não gerado.');

      if (typeof window.PluggyConnect === 'undefined') {
        throw new Error('Widget da Pluggy não carregado. Verifique sua conexão com a internet.');
      }

      const pluggyConnect = new window.PluggyConnect({
        connectToken: accessToken,
        includeSandbox: true,
        onSuccess: async (data) => {
          const itemId = data.item.id;
          setStatus('loading');
          try {
            const result = await fetchAPI('/api/pluggy/connect-item', 'POST', { itemId });
            setConnectedItem({ itemId, providerName: result.providerName });
            setStatus('connected');
          } catch (err) {
            setError('Banco conectado, mas falha ao registrar: ' + (err instanceof Error ? err.message : String(err)));
            setStatus('idle');
          }
        },
        onError: (err) => {
          console.error('Erro no widget Pluggy:', err);
          setError('Falha ao conectar com o banco.');
          setStatus('idle');
        },
        onClose: () => {
          if (status === 'loading') setStatus('idle');
        },
      });

      pluggyConnect.init();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('idle');
    }
  };

  const handleSync = async () => {
    if (!connectedItem) return;
    setStatus('syncing');
    setError(null);

    try {
      await fetchAPI(`/api/pluggy/sync/${connectedItem.itemId}`, 'POST');
      setStatus('done');
      onSyncComplete();
    } catch (err) {
      setError('Falha na sincronização: ' + (err instanceof Error ? err.message : String(err)));
      setStatus('connected');
    }
  };

  return (
    <div
      className="rounded-2xl p-5 border"
      style={{ backgroundColor: 'rgba(99,102,241,0.06)', borderColor: 'rgba(99,102,241,0.2)' }}
    >
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,rgba(99,102,241,0.3),rgba(168,85,247,0.3))', border: '1px solid rgba(99,102,241,0.3)' }}
        >
          <Building2 size={16} style={{ color: 'var(--color-primary)' }} />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Open Finance</p>
          <p className="text-xs text-textMuted">Conecte seu banco via Pluggy</p>
        </div>
        {status === 'done' && <CheckCircle2 size={18} className="text-teal-400 ml-auto" />}
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mb-3">
          {error}
        </p>
      )}

      {status === 'connected' && connectedItem && (
        <p className="text-xs text-teal-400 mb-3">
          Conectado: {connectedItem.providerName}
        </p>
      )}

      {status === 'done' && (
        <p className="text-xs text-teal-400 mb-3">
          Transacoes sincronizadas com sucesso!
        </p>
      )}

      <div className="space-y-2">
        {(status === 'idle' || status === 'loading') && (
          <button
            onClick={handleConnect}
            disabled={status === 'loading'}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,var(--color-primary),var(--color-secondary))' }}
          >
            {status === 'loading'
              ? <><Loader2 size={14} className="animate-spin" /> Conectando...</>
              : <><Link2 size={14} /> Conectar Banco</>
            }
          </button>
        )}

        {(status === 'connected' || status === 'syncing' || status === 'done') && (
          <button
            onClick={handleSync}
            disabled={status === 'syncing'}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}
          >
            {status === 'syncing'
              ? <><Loader2 size={14} className="animate-spin" /> Sincronizando...</>
              : <><RefreshCw size={14} /> Sincronizar Transacoes</>
            }
          </button>
        )}
      </div>
    </div>
  );
}
