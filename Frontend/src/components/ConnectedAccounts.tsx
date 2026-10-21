import { useEffect, useState } from 'react';

import {
  getSocialProviders, linkSocial, listLinkedProviders, takeOAuthError, unlinkSocial,
  SOCIAL_PROVIDER_LABELS, type SocialProvider,
} from '../services/auth';
import { SocialProviderIcon } from './SocialProviderIcon';

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const secondaryButton = 'px-4 py-2 rounded-xl text-sm text-textMuted border border-[var(--line)] hover:bg-white/5 hover:text-white transition-colors disabled:opacity-50';
const primaryButton = 'px-4 py-2 rounded-xl text-sm text-on-accent font-semibold transition-colors disabled:opacity-50';
const primaryStyle = { background: 'var(--color-primary)' };

/**
 * FIN-122 — conecta Google, GitHub e Microsoft à conta logada, para entrar também por eles. É o
 * caminho de quem já tem conta: o login social com o e-mail de uma conta existente não entra nela
 * sozinho (ver server/lib/betterAuth.js). Sem nenhum provedor configurado no servidor, nem aparece.
 */
export function ConnectedAccounts() {
  const [providers, setProviders] = useState<SocialProvider[] | null>(null);
  const [linked, setLinked] = useState<Map<SocialProvider, string>>(new Map());
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    // Voltou do provedor com erro ao conectar (?error=): mostra e tira da barra de endereço.
    const oauthError = takeOAuthError();
    if (oauthError) setError(oauthError);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [available, accounts] = await Promise.all([getSocialProviders(), listLinkedProviders()]);
        if (cancelled) return;
        setProviders(available);
        setLinked(new Map(accounts.map(a => [a.provider, a.id])));
        setLoadError('');
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err));
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const connect = async (provider: SocialProvider) => {
    setBusy(provider);
    setError('');
    setNotice('');
    try {
      await linkSocial(provider); // a página sai para o provedor e volta para Configurações
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  const disconnect = async (provider: SocialProvider, connectionId: string) => {
    if (!confirm(`Desconectar ${SOCIAL_PROVIDER_LABELS[provider]}? Você deixa de poder entrar por ele.`)) return;
    setBusy(provider);
    setError('');
    setNotice('');
    try {
      await unlinkSocial(connectionId);
      setLinked(prev => {
        const next = new Map(prev);
        next.delete(provider);
        return next;
      });
      setNotice(`${SOCIAL_PROVIDER_LABELS[provider]} desconectado.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  // Sem provedor configurado no servidor, a seção não tem o que oferecer.
  if (!loadError && providers !== null && providers.length === 0) return null;

  return (
    <section aria-labelledby="connected-accounts-title" className="panel rounded-2xl p-6">
      <div className="mb-5">
        <h2 id="connected-accounts-title" className="text-base font-medium text-white">Contas conectadas</h2>
        <p className="text-sm text-textMuted">
          Conecte uma conta do Google, GitHub ou Microsoft para entrar no FinFlow por ela, além do e-mail e senha.
        </p>
      </div>
      {notice && <p role="status" className="text-sm text-teal-400 mb-4">{notice}</p>}
      {error && (
        <div role="alert" className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
      )}
      {loadError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-red-400">{loadError}</p>
          <button type="button" onClick={() => { setLoadError(''); setReloadKey(k => k + 1); }} className={secondaryButton}>
            Tentar de novo
          </button>
        </div>
      ) : providers === null ? (
        <p className="text-sm text-textMuted">Carregando…</p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {providers.map(provider => {
            const connectionId = linked.get(provider);
            const label = SOCIAL_PROVIDER_LABELS[provider];
            return (
              <li key={provider} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <span className="flex items-center gap-3 text-sm text-white">
                  <SocialProviderIcon provider={provider} size={20} />
                  {label}
                  {connectionId && (
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold border border-teal-500/30 bg-teal-500/10 text-teal-400">Conectada</span>
                  )}
                </span>
                {connectionId ? (
                  <button type="button" onClick={() => disconnect(provider, connectionId)} disabled={busy !== null}
                    className={secondaryButton} aria-label={`Desconectar ${label}`}>
                    {busy === provider ? 'Desconectando…' : 'Desconectar'}
                  </button>
                ) : (
                  <button type="button" onClick={() => connect(provider)} disabled={busy !== null}
                    className={primaryButton} style={primaryStyle} aria-label={`Conectar ${label}`}>
                    {busy === provider ? 'Abrindo…' : 'Conectar'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
