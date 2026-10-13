import { useState } from 'react';
import { Mail, Lock, User, ArrowRight, ArrowLeft, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../services/api';
import { recoveryNotice } from '../utils/twoFactor';

type AuthUser = { id: string; name: string; email: string };

interface AuthFormProps {
  onLogin: (token: string, user: AuthUser) => void;
}

/**
 * Resposta de login/registro. Com a verificação em duas etapas ativa (FIN-078), o login com a
 * senha certa devolve só `twoFactorRequired`, e o token vem no segundo envio, junto do código.
 * Tudo `unknown` porque a resposta é normalizada antes de usada.
 */
interface AuthResponse {
  token?: unknown;
  user?: unknown;
  twoFactorRequired?: unknown;
  recoveryCodeUsed?: unknown;
  recoveryCodesRemaining?: unknown;
}

function isAuthUser(value: unknown): value is AuthUser {
  if (!value || typeof value !== 'object') return false;
  const u = value as Record<string, unknown>;
  return typeof u.id === 'string' && typeof u.name === 'string' && typeof u.email === 'string';
}

const inputClass = 'w-full bg-white/5 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-white focus:outline-none focus:border-primary/50 transition-colors';
const labelClass = 'block text-xs font-semibold text-textMuted uppercase tracking-wide mb-1.5 ml-1';

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const body = !isLogin ? { name, email, password }
        : twoFactorStep ? { email, password, code }
        : { email, password };

      const data = await apiFetch<AuthResponse | null>(endpoint, { method: 'POST', body });

      if (isLogin && !twoFactorStep && data?.twoFactorRequired === true) {
        setTwoFactorStep(true);
        return;
      }
      if (typeof data?.token !== 'string' || !isAuthUser(data.user)) {
        throw new Error('Resposta inesperada do servidor. Tente novamente.');
      }
      if (data.recoveryCodeUsed === true) {
        alert(recoveryNotice(typeof data.recoveryCodesRemaining === 'number' ? data.recoveryCodesRemaining : null));
      }
      onLogin(data.token, data.user);
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
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden"
         style={{ backgroundColor: 'var(--color-background)' }}>
      {/* Background glow effects */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 rounded-full blur-[100px] pointer-events-none" style={{ backgroundColor: 'rgba(99,102,241,0.15)' }} />
      <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none" style={{ backgroundColor: 'rgba(168,85,247,0.1)' }} />

      <div className="glass-card w-full max-w-md p-8 rounded-3xl z-10 mx-4">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center font-bold text-2xl text-on-accent mb-4"
            style={{ background: 'linear-gradient(135deg,var(--color-primary),var(--color-secondary))' }}>
            F
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">{title}</h2>
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
            className="w-full py-3.5 mt-2 rounded-xl text-on-accent font-bold tracking-wide flex items-center justify-center gap-2 shadow-xl transition-all disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,var(--color-primary),var(--color-secondary))' }}>
            {loading ? 'Aguarde...' : submitLabel}
            {!loading && <ArrowRight size={18} />}
          </button>
        </form>

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
