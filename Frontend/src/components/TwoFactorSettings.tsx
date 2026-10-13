import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { apiFetch } from '../services/api';
import { FormField } from './shared/FormField';
import {
  parseRecoveryCodes, parseTwoFactorSetup, parseTwoFactorStatus,
  type TwoFactorSetup, type TwoFactorStatus,
} from '../utils/twoFactor';

type Phase = 'idle' | 'setup' | 'codes' | 'disable';

const UNEXPECTED = 'Resposta inesperada do servidor.';

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

function formatSince(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('pt-BR');
}

function remainingText(remaining: number | null): string | null {
  if (remaining === null) return null;
  if (remaining === 0) return 'Nenhum código de recuperação restante — desative e ative de novo para gerar outros.';
  return remaining === 1 ? '1 código de recuperação restante.' : `${remaining} códigos de recuperação restantes.`;
}

const primaryButton = 'px-4 py-2.5 rounded-xl text-sm text-on-accent font-semibold transition-colors disabled:opacity-50';
const primaryStyle = { background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))' };
const secondaryButton = 'px-4 py-2.5 rounded-xl text-sm text-textMuted border border-white/10 hover:bg-white/5 hover:text-white transition-colors disabled:opacity-50';

/**
 * FIN-078 — ativação e desativação da verificação em duas etapas (TOTP). Ativar tem dois passos:
 * gerar o QR code e confirmar com a senha e um código do aplicativo; os códigos de recuperação
 * aparecem em seguida, uma única vez. Desativar pede a senha e um código.
 */
export function TwoFactorSettings({ token }: { token: string }) {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [setupData, setSetupData] = useState<TwoFactorSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<unknown>('/api/auth/2fa', { token });
        if (cancelled) return;
        // Normaliza a resposta: um corpo inesperado vira mensagem de erro, nunca uma exceção na tela.
        const parsed = parseTwoFactorStatus(data);
        setStatus(parsed);
        setLoadError(parsed ? '' : UNEXPECTED);
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err));
      }
    })();
    return () => { cancelled = true; };
  }, [token, reloadKey]);

  const resetForm = () => {
    setPassword('');
    setCode('');
    setError('');
  };

  const retryLoad = () => {
    setLoadError('');
    setReloadKey(k => k + 1);
  };

  const startSetup = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = parseTwoFactorSetup(await apiFetch<unknown>('/api/auth/2fa/setup', { method: 'POST', token, body: {} }));
      if (!data) throw new Error(UNEXPECTED);
      resetForm();
      setSetupData(data);
      setPhase('setup');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    let response: unknown;
    try {
      response = await apiFetch<unknown>('/api/auth/2fa/enable', { method: 'POST', token, body: { password, code } });
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
      setBusy(false);
      return;
    }
    setBusy(false);
    resetForm();
    setSetupData(null);
    const codes = parseRecoveryCodes(response);
    if (!codes) {
      // O servidor ativou, mas os códigos não vieram num formato legível: recarrega o estado
      // real e explica como obter códigos novos, em vez de fingir que nada aconteceu.
      setPhase('idle');
      setError('A verificação foi ativada, mas os códigos de recuperação não puderam ser exibidos. Desative e ative de novo para gerar outros.');
      setReloadKey(k => k + 1);
      return;
    }
    setRecoveryCodes(codes);
    setStatus(s => s && { ...s, enabled: true, enabledAt: new Date().toISOString(), recoveryCodesRemaining: codes.length });
    setPhase('codes');
  };

  const finishCodes = () => {
    setRecoveryCodes([]);
    setPhase('idle');
    setNotice('Verificação em duas etapas ativada.');
  };

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setNotice('Códigos copiados.');
    } catch {
      setNotice('Não foi possível copiar automaticamente — selecione os códigos e copie.');
    }
  };

  const confirmDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await apiFetch('/api/auth/2fa/disable', { method: 'POST', token, body: { password, code } });
      resetForm();
      setStatus(s => s && { ...s, enabled: false, enabledAt: null, recoveryCodesRemaining: null });
      setPhase('idle');
      setNotice('Verificação em duas etapas desativada.');
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    resetForm();
    setSetupData(null);
    setPhase('idle');
  };

  const renderBody = () => {
    if (loadError) {
      return (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-red-400">{loadError}</p>
          <button type="button" onClick={retryLoad} className={secondaryButton}>Tentar de novo</button>
        </div>
      );
    }
    if (!status) return <p className="text-sm text-textMuted">Carregando…</p>;

    if (phase === 'codes') {
      return (
        <div>
          <p className="text-sm text-amber-300 mb-3">
            Guarde estes códigos num lugar seguro, como um gerenciador de senhas. Cada um permite entrar uma vez sem o
            celular, e eles não serão mostrados de novo.
          </p>
          <ul aria-label="Códigos de recuperação" className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-sm mb-4">
            {recoveryCodes.map(c => (
              <li key={c} className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-center tracking-wider">{c}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={copyCodes} className={secondaryButton}>Copiar códigos</button>
            <button type="button" onClick={finishCodes} className={primaryButton} style={primaryStyle}>Já guardei os códigos</button>
          </div>
        </div>
      );
    }

    if (phase === 'setup' && setupData) {
      const grouped = setupData.secret.match(/.{1,4}/g)?.join(' ') ?? setupData.secret;
      return (
        <div className="flex flex-col md:flex-row gap-6">
          {/* Fundo branco fixo, em qualquer tema: leitores de QR code precisam do contraste. */}
          <img src={setupData.qrCode} alt="QR code para configurar o aplicativo autenticador" width={180} height={180}
            className="rounded-xl p-2 self-center md:self-start shrink-0"
            style={{ backgroundColor: '#ffffff', imageRendering: 'pixelated' }} />
          <div className="flex-1 min-w-0">
            <ol className="text-sm text-textMuted space-y-1.5 list-decimal ml-4 mb-4">
              <li>No aplicativo autenticador, adicione uma conta e escaneie o QR code.</li>
              <li>
                Sem câmera? Digite a chave <code className="text-white font-mono break-all">{grouped}</code>
              </li>
              <li>Confirme com a sua senha e o código de 6 dígitos que o aplicativo mostrar.</li>
            </ol>
            <form onSubmit={confirmEnable} className="space-y-3">
              <FormField label="Sua senha" htmlFor="twofa-enable-password">
                <input id="twofa-enable-password" type="password" required autoComplete="current-password"
                  value={password} onChange={e => setPassword(e.target.value)} className="input-field" />
              </FormField>
              <FormField label="Código do aplicativo" htmlFor="twofa-enable-code">
                <input id="twofa-enable-code" type="text" required inputMode="numeric" autoComplete="one-time-code" maxLength={7}
                  value={code} onChange={e => setCode(e.target.value)} className="input-field tracking-widest" placeholder="123456" />
              </FormField>
              <div className="flex flex-wrap gap-3 pt-1">
                <button type="button" onClick={cancel} className={secondaryButton}>Cancelar</button>
                <button type="submit" disabled={busy} className={primaryButton} style={primaryStyle}>
                  {busy ? 'Ativando…' : 'Ativar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      );
    }

    if (status.enabled) {
      const since = formatSince(status.enabledAt);
      const remaining = remainingText(status.recoveryCodesRemaining);
      const fewLeft = status.recoveryCodesRemaining !== null && status.recoveryCodesRemaining <= 2;
      return (
        <div>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold border border-teal-500/30 bg-teal-500/10 text-teal-400">Ativa</span>
            {since && <span className="text-textMuted">desde {since}</span>}
          </p>
          {remaining && <p className={`text-sm mt-2 ${fewLeft ? 'text-amber-300' : 'text-textMuted'}`}>{remaining}</p>}
          {!status.available && (
            <p className="text-sm text-amber-300 mt-2">
              A chave de cifragem não está disponível no servidor: até ela voltar, o login só aceita os códigos de recuperação.
            </p>
          )}
          {phase === 'disable' ? (
            <form onSubmit={confirmDisable} className="space-y-3 mt-4">
              <FormField label="Sua senha" htmlFor="twofa-disable-password">
                <input id="twofa-disable-password" type="password" required autoComplete="current-password"
                  value={password} onChange={e => setPassword(e.target.value)} className="input-field" />
              </FormField>
              <FormField label="Código do aplicativo ou de recuperação" htmlFor="twofa-disable-code">
                <input id="twofa-disable-code" type="text" required autoComplete="one-time-code" maxLength={16}
                  value={code} onChange={e => setCode(e.target.value)} className="input-field tracking-widest" />
              </FormField>
              <div className="flex flex-wrap gap-3 pt-1">
                <button type="button" onClick={cancel} className={secondaryButton}>Cancelar</button>
                <button type="submit" disabled={busy}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50">
                  {busy ? 'Desativando…' : 'Confirmar desativação'}
                </button>
              </div>
            </form>
          ) : (
            <button type="button" onClick={() => { resetForm(); setNotice(''); setPhase('disable'); }} className={`${secondaryButton} mt-4`}>
              Desativar
            </button>
          )}
        </div>
      );
    }

    if (!status.available) {
      return (
        <p className="text-sm text-textMuted">
          O servidor ainda não está configurado para a verificação em duas etapas: falta a variável
          <code className="mx-1 text-white">TWO_FACTOR_ENCRYPTION_KEY</code>no arquivo <code className="text-white">.env</code> (veja o <code className="text-white">.env.example</code>).
        </p>
      );
    }

    return (
      <button type="button" onClick={startSetup} disabled={busy} className={primaryButton} style={primaryStyle}>
        {busy ? 'Gerando QR code…' : 'Ativar verificação em duas etapas'}
      </button>
    );
  };

  return (
    <section aria-labelledby="twofa-title" className="glass-card rounded-2xl p-6">
      <div className="flex items-start gap-3 mb-5">
        <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 shrink-0">
          <ShieldCheck size={20} className="text-primary" />
        </div>
        <div>
          <h2 id="twofa-title" className="text-lg font-semibold text-white">Verificação em duas etapas</h2>
          <p className="text-sm text-textMuted">
            Além da senha, o login pede um código de 6 dígitos do aplicativo autenticador do celular (Google Authenticator,
            Microsoft Authenticator, Authy, 1Password…).
          </p>
        </div>
      </div>
      {notice && <p role="status" className="text-sm text-teal-400 mb-4">{notice}</p>}
      {error && (
        <div role="alert" className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
      )}
      {renderBody()}
    </section>
  );
}
