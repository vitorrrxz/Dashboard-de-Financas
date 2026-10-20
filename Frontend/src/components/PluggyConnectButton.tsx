import { useState, useCallback, useEffect } from 'react';
import { Link2, RefreshCw, Loader2, AlertTriangle } from 'lucide-react';
import { apiFetch, ApiError } from '../services/api';
import { formatRelativeTime } from '../utils/dates';

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

/** FIN-107 — conexão com um banco (item da Pluggy), como a API devolve. */
interface PluggyItemInfo {
  pluggyId: string;
  providerName: string;
  status: string;
  lastSyncAt: string | null;
}

// Normaliza a lista vinda da API: uma resposta fora do formato não pode quebrar a barra lateral.
function parseItems(data: unknown): PluggyItemInfo[] | null {
  const items = (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return null;
  return items.filter((item): item is PluggyItemInfo => {
    const i = item as Partial<Record<keyof PluggyItemInfo, unknown>> | null;
    return typeof i?.pluggyId === 'string' && typeof i.providerName === 'string'
      && typeof i.status === 'string' && (i.lastSyncAt === null || typeof i.lastSyncAt === 'string');
  });
}

function lastSyncLabel(item: PluggyItemInfo): string {
  const when = item.lastSyncAt ? formatRelativeTime(item.lastSyncAt) : '';
  return when ? `Última sincronização: ${when}` : 'Ainda não sincronizado';
}

export function PluggyConnectButton({ token, onSyncComplete }: PluggyConnectButtonProps) {
  const [items, setItems] = useState<PluggyItemInfo[]>([]);
  const [connecting, setConnecting] = useState(false);
  // FIN-107: a sincronização automática sai assim que o componente monta.
  const [autoSyncing, setAutoSyncing] = useState(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // FIN-041: distingue "precisa reconectar o banco" (LOGIN_ERROR/OUTDATED reportado pelo
  // backend) de um erro genérico — exibido com destaque próprio, orientando a ação.
  const [needsReauth, setNeedsReauth] = useState(false);

  const fetchAPI = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (endpoint: string, method = 'POST', body?: unknown): Promise<any> => apiFetch(endpoint, { method, body, token }),
    [token]
  );

  // FIN-107: pede ao servidor a sincronização das conexões paradas há mais de 6 h — a regra, e a
  // trava que impede duas abas de sincronizar a mesma conexão, ficam lá — e mostra a lista devolvida.
  // Uma falha fica no console: o painel continua com os dados que já carregou.
  const autoSync = async () => {
    try {
      const data = await fetchAPI('/api/pluggy/auto-sync');
      const list = parseItems(data);
      if (list) setItems(list);
      if (Number(data?.synced) > 0) onSyncComplete();
    } catch (err) {
      console.error('Falha na sincronização automática com a Pluggy:', err);
    } finally {
      setAutoSyncing(false);
    }
  };

  // Uma vez, ao abrir o app: o componente só monta depois da carga inicial dos dados.
  useEffect(() => {
    void autoSync();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    setNeedsReauth(false);

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
          setConnecting(true);
          try {
            const result = await fetchAPI('/api/pluggy/connect-item', 'POST', { itemId });
            // FIN-041: um item pode nascer já em LOGIN_ERROR/OUTDATED (ex. credenciais
            // rejeitadas pelo banco na primeira tentativa) — avisa mesmo tendo "conectado".
            if (typeof result?.statusMessage === 'string' && result.statusMessage) {
              setNeedsReauth(true);
              setError(result.statusMessage);
            }
            // FIN-107: a conexão nova ainda não sincronizou — a automática já a traz, e lista.
            setAutoSyncing(true);
            await autoSync();
          } catch (err) {
            setError('Banco conectado, mas falha ao registrar: ' + (err instanceof Error ? err.message : String(err)));
          } finally {
            setConnecting(false);
          }
        },
        onError: (err) => {
          console.error('Erro no widget Pluggy:', err);
          setError('Falha ao conectar com o banco.');
          setConnecting(false);
        },
        onClose: () => setConnecting(false),
      });

      pluggyConnect.init();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConnecting(false);
    }
  };

  const handleSync = async (item: PluggyItemInfo) => {
    setSyncingId(item.pluggyId);
    setError(null);
    setNeedsReauth(false);

    try {
      await fetchAPI(`/api/pluggy/sync/${encodeURIComponent(item.pluggyId)}`);
      const now = new Date().toISOString();
      setItems(list => list.map(i => (i.pluggyId === item.pluggyId ? { ...i, lastSyncAt: now } : i)));
      onSyncComplete();
    } catch (err) {
      // FIN-041: status 409 = backend detectou que o item precisa de reautenticação
      // (LOGIN_ERROR/OUTDATED) — mensagem já vem pronta e acionável, sem o prefixo
      // genérico "Falha na sincronização".
      if (err instanceof ApiError && err.status === 409) {
        setNeedsReauth(true);
        setError(err.message);
      } else {
        setError('Falha na sincronização: ' + (err instanceof Error ? err.message : String(err)));
      }
    } finally {
      setSyncingId(null);
    }
  };

  const busy = autoSyncing || syncingId !== null;

  return (
    <div className="rounded-2xl p-3 bg-white/[0.04]">
      <p className="text-sm font-medium text-white">Open Finance</p>
      <p className="text-xs text-textMuted mb-3">Bancos conectados via Pluggy</p>

      {error && needsReauth && (
        <p className="text-xs text-amber-400 mb-3 flex items-center gap-2">
          <AlertTriangle size={14} className="shrink-0" /> {error}
        </p>
      )}
      {error && !needsReauth && (
        <p className="text-xs text-red-400 mb-3">
          {error}
        </p>
      )}

      {items.length > 0 && (
        <ul className="space-y-2 mb-3">
          {items.map(item => (
            <li key={item.pluggyId} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-white truncate">{item.providerName}</p>
                {item.status === 'LOGIN_ERROR'
                  ? <p className="text-xs text-amber-400">Login expirado: reconecte o banco</p>
                  : <p className="text-xs text-textMuted">{lastSyncLabel(item)}</p>}
              </div>
              <button
                type="button"
                onClick={() => handleSync(item)}
                disabled={busy}
                aria-label={`Sincronizar ${item.providerName}`}
                title={`Sincronizar ${item.providerName}`}
                className="p-2 rounded-md text-textMuted hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-50"
              >
                <RefreshCw size={14} className={syncingId === item.pluggyId ? 'animate-spin' : undefined} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {autoSyncing && (
        <p role="status" className="text-xs text-textMuted mb-3 flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" /> Atualizando os dados do banco…
        </p>
      )}

      <button
        type="button"
        onClick={handleConnect}
        disabled={connecting}
        className="w-full h-8 rounded-md text-sm text-white bg-card border border-[var(--line)] hover:border-[var(--color-textMuted)] flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
      >
        {connecting
          ? <><Loader2 size={14} className="animate-spin" /> Conectando...</>
          : <><Link2 size={14} /> Conectar banco</>
        }
      </button>
    </div>
  );
}
