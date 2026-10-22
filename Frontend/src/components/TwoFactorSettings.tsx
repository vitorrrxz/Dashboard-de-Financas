import { useEffect, useState } from 'react';

import {
  confirmTwoFactorSetup, disableTwoFactor, getTwoFactorPolicy, getTwoFactorUri, hasPassword, isTwoFactorEnabled,
  startTwoFactorSetup,
} from '../services/auth';
import { FormField } from './shared/FormField';
import { twoFactorSetupFromUri, type TwoFactorSetup } from '../utils/twoFactor';

// `reshow-password`/`reshow`: o QR code da verificação já ativa, para configurar outro celular (FIN-123).
type Phase = 'idle' | 'password' | 'setup' | 'codes' | 'disable' | 'reshow-password' | 'reshow';

const UNEXPECTED = 'Resposta inesperada do servidor.';

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const primaryButton = 'px-4 py-2.5 rounded-xl text-sm text-on-accent font-semibold transition-colors disabled:opacity-50';
const primaryStyle = { background: 'var(--color-primary)' };
const secondaryButton = 'px-4 py-2.5 rounded-xl text-sm text-textMuted border border-[var(--line)] hover:bg-white/5 hover:text-white transition-colors disabled:opacity-50';

/** QR code e chave do aplicativo autenticador. Fundo branco fixo, em qualquer tema: leitores de QR code precisam do contraste. */
function AuthenticatorQr({ data }: { data: TwoFactorSetup }) {
  return (
    <img src={data.qrCode} alt="QR code para configurar o aplicativo autenticador" width={180} height={180}
      className="rounded-xl p-2 self-center md:self-start shrink-0"
      style={{ backgroundColor: '#ffffff', imageRendering: 'pixelated' }} />
  );
}

const groupedSecret = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

interface TwoFactorSettingsProps {
  /** Chamado quando a ativação termina (códigos de recuperação guardados) — ver TwoFactorSetupGate. */
  onEnabled?: () => void;
}

/**
 * FIN-078/FIN-121 — ativação e desativação da verificação em duas etapas (TOTP), pelo plugin
 * twoFactor do Better Auth. Ativar tem três passos: a senha gera o QR code, um código do aplicativo
 * confirma, e os códigos de recuperação aparecem em seguida, uma única vez. Desativar pede a senha.
 *
 * FIN-123 — com a verificação obrigatória no servidor, não há "Desativar": no lugar, "Configurar em
 * outro celular" mostra o mesmo QR code de novo. Conta sem senha (só Google/GitHub) não digita senha.
 */
export function TwoFactorSettings({ onEnabled }: TwoFactorSettingsProps = {}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [required, setRequired] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [setupData, setSetupData] = useState<TwoFactorSetup | null>(null);
  // Gerados junto com o segredo, mas só mostrados depois da confirmação com o código.
  const [pendingCodes, setPendingCodes] = useState<string[]>([]);
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
        const [active, policy, withPassword] = await Promise.all([isTwoFactorEnabled(), getTwoFactorPolicy(), hasPassword()]);
        if (cancelled) return;
        setEnabled(active);
        setRequired(policy.required);
        setNeedsPassword(withPassword);
        setLoadError('');
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err));
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const resetForm = () => {
    setPassword('');
    setCode('');
    setError('');
  };

  const retryLoad = () => {
    setLoadError('');
    setReloadKey(k => k + 1);
  };

  const startSetup = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { totpURI, backupCodes } = await startTwoFactorSetup(needsPassword ? password : undefined);
      const data = twoFactorSetupFromUri(totpURI);
      if (!data || backupCodes.length === 0) throw new Error(UNEXPECTED);
      resetForm();
      setSetupData(data);
      setPendingCodes(backupCodes);
      setPhase('setup');
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const confirmEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await confirmTwoFactorSetup(code);
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
      setBusy(false);
      return;
    }
    setBusy(false);
    resetForm();
    setSetupData(null);
    setRecoveryCodes(pendingCodes);
    setPendingCodes([]);
    setEnabled(true);
    setPhase('codes');
  };

  const finishCodes = () => {
    setRecoveryCodes([]);
    setPhase('idle');
    setNotice('Verificação em duas etapas ativada.');
    onEnabled?.();
  };

  const showQrAgain = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = twoFactorSetupFromUri(await getTwoFactorUri(needsPassword ? password : undefined));
      if (!data) throw new Error(UNEXPECTED);
      resetForm();
      setSetupData(data);
      setPhase('reshow');
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
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
      await disableTwoFactor(needsPassword ? password : undefined);
      resetForm();
      setEnabled(false);
      setPhase('idle');
      setNotice('Verificação em duas etapas desativada.');
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    resetForm();
    setSetupData(null);
    setPendingCodes([]);
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
    if (enabled === null) return <p className="text-sm text-textMuted">Carregando…</p>;

    if (phase === 'codes') {
      return (
        <div>
          <p className="text-sm text-amber-300 mb-3">
            Guarde estes códigos num lugar seguro, como um gerenciador de senhas. Cada um permite entrar uma vez sem o
            celular, e eles não serão mostrados de novo.
          </p>
          <ul aria-label="Códigos de recuperação" className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-sm mb-4">
            {recoveryCodes.map(c => (
              <li key={c} className="px-3 py-2 rounded-lg bg-white/5 border border-[var(--line)] text-white text-center">{c}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={copyCodes} className={secondaryButton}>Copiar códigos</button>
            <button type="button" onClick={finishCodes} className={primaryButton} style={primaryStyle}>Já guardei os códigos</button>
          </div>
        </div>
      );
    }

    if (phase === 'reshow' && setupData) {
      return (
        <div className="flex flex-col md:flex-row gap-6">
          <AuthenticatorQr data={setupData} />
          <div className="flex-1 min-w-0">
            <ol className="text-sm text-textMuted space-y-1.5 list-decimal ml-4 mb-4">
              <li>No aplicativo autenticador do celular novo, adicione uma conta e escaneie o QR code.</li>
              <li>
                Sem câmera? Digite a chave <code className="text-white font-mono break-all">{groupedSecret(setupData.secret)}</code>
              </li>
              <li>Os códigos dos dois celulares passam a valer — apague a conta do antigo, se não for mais usá-lo.</li>
            </ol>
            <button type="button" onClick={cancel} className={primaryButton} style={primaryStyle}>Pronto</button>
          </div>
        </div>
      );
    }

    if (phase === 'setup' && setupData) {
      return (
        <div className="flex flex-col md:flex-row gap-6">
          <AuthenticatorQr data={setupData} />
          <div className="flex-1 min-w-0">
            <ol className="text-sm text-textMuted space-y-1.5 list-decimal ml-4 mb-4">
              <li>No aplicativo autenticador, adicione uma conta e escaneie o QR code.</li>
              <li>
                Sem câmera? Digite a chave <code className="text-white font-mono break-all">{groupedSecret(setupData.secret)}</code>
              </li>
              <li>Confirme com o código de 6 dígitos que o aplicativo mostrar.</li>
            </ol>
            <form onSubmit={confirmEnable} className="space-y-3">
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

    if (enabled) {
      return (
        <div>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold border border-teal-500/30 bg-teal-500/10 text-teal-400">Ativa</span>
          </p>
          {phase === 'reshow-password' ? (
            <form onSubmit={showQrAgain} className="space-y-3 mt-4 max-w-sm">
              <FormField label="Sua senha" htmlFor="twofa-reshow-password">
                <input id="twofa-reshow-password" type="password" required autoComplete="current-password" autoFocus
                  value={password} onChange={e => setPassword(e.target.value)} className="input-field" />
              </FormField>
              <div className="flex flex-wrap gap-3 pt-1">
                <button type="button" onClick={cancel} className={secondaryButton}>Cancelar</button>
                <button type="submit" disabled={busy} className={primaryButton} style={primaryStyle}>
                  {busy ? 'Carregando…' : 'Mostrar QR code'}
                </button>
              </div>
            </form>
          ) : required ? (
            <button type="button" disabled={busy}
              onClick={() => { resetForm(); setNotice(''); if (needsPassword) setPhase('reshow-password'); else void showQrAgain(); }}
              className={`${secondaryButton} mt-4`}>
              Configurar em outro celular
            </button>
          ) : phase === 'disable' ? (
            <form onSubmit={confirmDisable} className="space-y-3 mt-4">
              {needsPassword && (
                <FormField label="Sua senha" htmlFor="twofa-disable-password">
                  <input id="twofa-disable-password" type="password" required autoComplete="current-password"
                    value={password} onChange={e => setPassword(e.target.value)} className="input-field" />
                </FormField>
              )}
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

    if (phase === 'password') {
      return (
        <form onSubmit={startSetup} className="space-y-3 max-w-sm">
          <FormField label="Sua senha" htmlFor="twofa-enable-password">
            <input id="twofa-enable-password" type="password" required autoComplete="current-password" autoFocus
              value={password} onChange={e => setPassword(e.target.value)} className="input-field" />
          </FormField>
          <div className="flex flex-wrap gap-3 pt-1">
            <button type="button" onClick={cancel} className={secondaryButton}>Cancelar</button>
            <button type="submit" disabled={busy} className={primaryButton} style={primaryStyle}>
              {busy ? 'Gerando QR code…' : 'Continuar'}
            </button>
          </div>
        </form>
      );
    }

    return (
      <button type="button" disabled={busy}
        onClick={() => { resetForm(); setNotice(''); if (needsPassword) setPhase('password'); else void startSetup(); }}
        className={primaryButton} style={primaryStyle}>
        {busy ? 'Gerando QR code…' : 'Ativar verificação em duas etapas'}
      </button>
    );
  };

  return (
    <section aria-labelledby="twofa-title" className="panel rounded-2xl p-6">
      <div className="flex items-start gap-3 mb-5">
        <div>
          <h2 id="twofa-title" className="text-base font-medium text-white">Verificação em duas etapas</h2>
          <p className="text-sm text-textMuted">
            Além da senha, o login pede um código de 6 dígitos do aplicativo autenticador do celular (Google Authenticator,
            Microsoft Authenticator, Authy, 1Password…).{required && ' Obrigatória em todas as contas.'}
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
