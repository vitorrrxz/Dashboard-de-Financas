import { useEffect, useState } from 'react';
import { Mail, Lock, User, ArrowRight, ArrowLeft, ShieldCheck } from 'lucide-react';
import {
  getSocialProviders, signIn, signInSocial, signUp, takeOAuthError, takeTwoFactorRedirect, verifyTwoFactor,
  SOCIAL_PROVIDER_LABELS, type AuthUser, type SocialProvider,
} from '../services/auth';
import { recoveryNotice } from '../utils/twoFactor';
import { FinFlowMark } from './FinFlowMark';
import { SocialProviderIcon } from './SocialProviderIcon';

interface AuthFormProps {
  /** Chamado já com a sessão aberta: o cookie veio na resposta do login (FIN-121). */
  onLogin: (user: AuthUser) => void;
}

const inputClass = 'w-full bg-white/5 border border-[var(--line)] rounded-xl pl-11 pr-4 py-3 text-white focus:outline-none focus:border-primary/50 transition-colors';
const labelClass = 'block text-xs font-semibold text-textMuted mb-1.5 ml-1';

export function AuthForm({ onLogin }: AuthFormProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // FIN-078 — segundo passo do login, quando a conta tem verificação em duas etapas.
  const [twoFactorStep, setTwoFactorStep] = useState(false);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  // FIN-122 — login com Google, GitHub e Microsoft: só os provedores configurados no servidor.
  const [providers, setProviders] = useState<SocialProvider[]>([]);
  const [redirectingTo, setRedirectingTo] = useState<SocialProvider | null>(null);

  useEffect(() => {
    // Voltou do provedor com erro (?error=): mostra e tira da barra de endereço.
    const oauthError = takeOAuthError();
    if (oauthError) setError(oauthError);
    // FIN-123: voltou do provedor numa conta com verificação em duas etapas — falta só o código.
    if (takeTwoFactorRedirect()) setTwoFactorStep(true);
    let cancelled = false;
    getSocialProviders()
      .then(list => { if (!cancelled) setProviders(list); })
      // Sem a lista, a tela fica só com e-mail e senha.
      .catch(err => console.error('Falha ao carregar os provedores de login:', err));
    return () => { cancelled = true; };
  }, []);

  /** Leva à tela do provedor — a página sai daqui, e volta já logada. */
  const handleSocial = async (provider: SocialProvider) => {
    setError('');
    setRedirectingTo(provider);
    try {
      await signInSocial(provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRedirectingTo(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (!isLogin) {
        onLogin(await signUp(name, email, password));
        return;
      }
      if (twoFactorStep) {
        const user = await verifyTwoFactor(code, useRecovery);
        if (useRecovery) alert(recoveryNotice(null));
        onLogin(user);
        return;
      }
      // FIN-078: com a verificação em duas etapas ativa, a senha certa só leva ao passo do código.
      const result = await signIn(email, password);
      if ('twoFactorRequired' in result) {
        setTwoFactorStep(true);
        return;
      }
      onLogin(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (twoFactorStep) setCode('');
    } finally {
      setLoading(false);
    }
  };

  /** Volta do passo do código para e-mail e senha — a senha é digitada de novo. */
  const leaveTwoFactorStep = () => {
    setTwoFactorStep(false);
    setCode('');
    setPassword('');
    setUseRecovery(false);
    setError('');
  };

  const toggleMode = () => {
    leaveTwoFactorStep();
    setIsLogin(!isLogin);
  };

  const title = twoFactorStep ? 'Verificação em duas etapas' : isLogin ? 'Bem-vindo de volta!' : 'Crie sua conta';
  const subtitle = !twoFactorStep ? 'Seu sistema financeiro particular e seguro.'
    : useRecovery ? 'Digite um dos seus códigos de recuperação.'
    : 'Digite o código de 6 dígitos do seu aplicativo autenticador.';
  const submitLabel = twoFactorStep ? 'Verificar' : isLogin ? 'Entrar no Sistema' : 'Criar Conta';

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="panel w-full max-w-sm p-8 rounded-2xl mx-4">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-6">
            <FinFlowMark />
            <span className="text-sm font-medium text-white">FinFlow</span>
          </div>
          <h2 className="text-2xl font-medium tracking-tight text-white mb-1">{title}</h2>
          <p className="text-textMuted text-sm">{subtitle}</p>
        </div>

        {error && (
          <div role="alert" className="mb-6 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {twoFactorStep ? (
            <div>
              <label htmlFor="auth-code" className={labelClass}>
                {useRecovery ? 'Código de recuperação' : 'Código do aplicativo'}
              </label>
              <div className="relative">
                <ShieldCheck size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-textMuted" />
                <input
                  id="auth-code" type="text" required autoFocus value={code} onChange={e => setCode(e.target.value)}
                  inputMode={useRecovery ? 'text' : 'numeric'}
                  autoComplete={useRecovery ? 'off' : 'one-time-code'}
                  autoCapitalize={useRecovery ? 'characters' : 'off'}
                  maxLength={useRecovery ? 16 : 7}
                  aria-describedby="auth-code-hint"
                  className={`${inputClass} tracking-widest`}
                  placeholder={useRecovery ? 'XXXXX-XXXXX' : '123456'}
                />
              </div>
              <p id="auth-code-hint" className="text-xs text-textMuted mt-1.5 ml-1">
                {useRecovery ? 'Cada código de recuperação vale uma única vez.' : 'O código muda a cada 30 segundos.'}
              </p>
            </div>
          ) : (
            <>
              {!isLogin && (
                <div>
                  <label htmlFor="auth-name" className={labelClass}>Nome Completo</label>
                  <div className="relative">
                    <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-textMuted" />
                    <input
                      id="auth-name" type="text" required autoComplete="name" value={name} onChange={e => setName(e.target.value)}
                      className={inputClass}
                      placeholder="Nome completo"
                    />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="auth-email" className={labelClass}>E-mail</label>
                <div className="relative">
                  <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-textMuted" />
                  <input
                    id="auth-email" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)}
                    className={inputClass}
                    placeholder="seu@email.com"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="auth-password" className={labelClass}>Senha</label>
                <div className="relative">
                  <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-textMuted" />
                  <input
                    id="auth-password" type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
                    autoComplete={isLogin ? 'current-password' : 'new-password'}
                    className={inputClass}
                    placeholder="••••••••"
                  />
                </div>
              </div>
            </>
          )}

          <button type="submit" disabled={loading}
            className="w-full py-3.5 mt-2 rounded-xl text-on-accent font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            style={{ background: 'var(--color-primary)' }}>
            {loading ? 'Aguarde...' : submitLabel}
            {!loading && <ArrowRight size={18} />}
          </button>
        </form>

        {!twoFactorStep && providers.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-3 mb-4" aria-hidden="true">
              <span className="h-px flex-1 bg-[var(--line)]" />
              <span className="text-xs text-textMuted">ou</span>
              <span className="h-px flex-1 bg-[var(--line)]" />
            </div>
            <div className="space-y-2.5">
              {providers.map(provider => (
                <button key={provider} type="button" onClick={() => handleSocial(provider)} disabled={redirectingTo !== null}
                  className="w-full py-3 rounded-xl border border-[var(--line)] bg-white/5 text-white text-sm font-medium flex items-center justify-center gap-2.5 hover:bg-white/10 transition-colors disabled:opacity-50">
                  <SocialProviderIcon provider={provider} />
                  {redirectingTo === provider ? 'Abrindo…' : `Continuar com ${SOCIAL_PROVIDER_LABELS[provider]}`}
                </button>
              ))}
            </div>
          </div>
        )}

        {twoFactorStep ? (
          <div className="mt-6 flex flex-col items-center gap-3 text-sm">
            <button type="button" onClick={() => { setUseRecovery(!useRecovery); setCode(''); setError(''); }}
              className="font-semibold text-white hover:text-primary transition-colors">
              {useRecovery ? 'Usar o código do aplicativo' : 'Usar um código de recuperação'}
            </button>
            <button type="button" onClick={leaveTwoFactorStep}
              className="flex items-center gap-1.5 text-textMuted hover:text-white transition-colors">
              <ArrowLeft size={14} /> Voltar
            </button>
          </div>
        ) : (
          <div className="mt-6 text-center">
            <p className="text-sm text-textMuted">
              {isLogin ? 'Ainda não tem uma conta?' : 'Já possui uma conta?'}
              <button onClick={toggleMode} type="button"
                className="ml-2 font-semibold text-white hover:text-primary transition-colors">
                {isLogin ? 'Cadastre-se' : 'Faça login'}
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
