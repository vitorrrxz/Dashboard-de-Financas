import { useState } from 'react';
import { Mail, Lock, User, ArrowRight } from 'lucide-react';

interface AuthFormProps {
  onLogin: (token: string, user: any) => void;
}

export function AuthForm({ onLogin }: AuthFormProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const body = isLogin ? { email, password } : { name, email, password };

      const res = await fetch(`http://localhost:3001${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro na autenticação');

      onLogin(data.token, data.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" 
         style={{ backgroundColor: 'var(--color-background)' }}>
      {/* Background glow effects */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 rounded-full blur-[100px] pointer-events-none" style={{ backgroundColor: 'rgba(99,102,241,0.15)' }} />
      <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none" style={{ backgroundColor: 'rgba(168,85,247,0.1)' }} />

      <div className="glass-card w-full max-w-md p-8 rounded-3xl z-10 mx-4">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center font-bold text-2xl text-white mb-4"
            style={{ background: 'linear-gradient(135deg,var(--color-primary),var(--color-secondary))' }}>
            F
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">{isLogin ? 'Bem-vindo de volta!' : 'Crie sua conta'}</h2>
          <p className="text-textMuted text-sm">Seu sistema financeiro particular e seguro.</p>
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-xs font-semibold text-textMuted uppercase tracking-wide mb-1.5 ml-1">Nome Completo</label>
              <div className="relative">
                <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-textMuted" />
                <input 
                  type="text" required value={name} onChange={e => setName(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-white focus:outline-none focus:border-primary/50 transition-colors" 
                  placeholder="Nome completo" 
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-textMuted uppercase tracking-wide mb-1.5 ml-1">E-mail</label>
            <div className="relative">
              <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-textMuted" />
              <input 
                type="email" required value={email} onChange={e => setEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-white focus:outline-none focus:border-primary/50 transition-colors" 
                placeholder="seu@email.com" 
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-textMuted uppercase tracking-wide mb-1.5 ml-1">Senha</label>
            <div className="relative">
              <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-textMuted" />
              <input 
                type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-white focus:outline-none focus:border-primary/50 transition-colors" 
                placeholder="••••••••" 
              />
            </div>
          </div>

          <button type="submit" disabled={loading}
            className="w-full py-3.5 mt-2 rounded-xl text-white font-bold tracking-wide flex items-center justify-center gap-2 shadow-xl transition-all disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,var(--color-primary),var(--color-secondary))' }}>
            {loading ? 'Aguarde...' : (isLogin ? 'Entrar no Sistema' : 'Criar Conta')}
            {!loading && <ArrowRight size={18} />}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-textMuted">
            {isLogin ? 'Ainda não tem uma conta?' : 'Já possui uma conta?'}
            <button onClick={() => setIsLogin(!isLogin)} type="button"
              className="ml-2 font-semibold text-white hover:text-primary transition-colors">
              {isLogin ? 'Cadastre-se' : 'Faça login'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
