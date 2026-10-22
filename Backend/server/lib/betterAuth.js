import './env.js';
import bcrypt from 'bcrypt';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthEndpoint, createAuthMiddleware } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { bearer, twoFactor } from 'better-auth/plugins';
import { prisma } from './prisma.js';

// FIN-121 — autenticação pelo Better Auth: cadastro, login, sessão e verificação em duas etapas
// moram em /api/auth/* (rotas dele). A sessão fica num cookie httpOnly — o JavaScript da página não
// a enxerga, ao contrário do token no localStorage de antes (FIN-110) — e numa tabela, o que permite
// encerrá-la no servidor. O plugin `bearer` aceita o mesmo token no cabeçalho Authorization, para
// clientes que não são o navegador (testes de integração, scripts).

// Sem fallback: um segredo conhecido permitiria forjar cookies de sessão (ver FIN-006).
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
if (!BETTER_AUTH_SECRET || BETTER_AUTH_SECRET.length < 32) {
  console.error(
    '\n❌ BETTER_AUTH_SECRET ausente ou fraco (mínimo 32 caracteres).\n' +
    '   Defina BETTER_AUTH_SECRET no arquivo .env antes de iniciar o servidor.\n' +
    '   Para gerar uma chave segura, rode:\n' +
    '   node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n'
  );
  process.exit(1);
}

// bcrypt, e não o scrypt padrão do Better Auth: as senhas cadastradas antes da migração (copiadas de
// User.passwordHash para AuthAccount.password) continuam valendo, sem pedir troca a ninguém.
const BCRYPT_ROUNDS = 10;

// Mesmo limite de antes (FIN-007): 10 tentativas a cada 15 minutos por IP nas rotas que recebem senha
// ou código. AUTH_RATE_LIMIT existe só para a suíte de testes, que faz dezenas de cadastros seguidos.
const authAttemptsRule = { window: 15 * 60, max: Number(process.env.AUTH_RATE_LIMIT) || 10 };

// Login desativado temporariamente: com VITE_AUTH_DISABLED=true (fora de produção), o frontend pula a
// tela de login e pede aqui uma sessão do primeiro usuário cadastrado — o app é de um usuário só. Sem a
// variável, a rota responde 404 e o login volta a ser exigido.
const localSession = () => ({
  id: 'local-session',
  endpoints: {
    localSession: createAuthEndpoint('/local-session', { method: 'POST' }, async ctx => {
      if (process.env.VITE_AUTH_DISABLED !== 'true' || process.env.NODE_ENV === 'production') {
        throw new APIError('NOT_FOUND', { message: 'Não encontrado.' });
      }
      // Banco vazio: cria o usuário local sem senha (o login fica desativado mesmo).
      const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })
        ?? await ctx.context.internalAdapter.createUser({ name: 'Local', email: 'local@finflow.local', emailVerified: false });
      const session = await ctx.context.internalAdapter.createSession(user.id);
      await setSessionCookie(ctx, { session, user });
      return ctx.json({ token: session.token, user: { id: user.id, name: user.name, email: user.email } });
    }),
  },
});

export const auth = betterAuth({
  appName: 'FinFlow',
  secret: BETTER_AUTH_SECRET,
  // Sem BETTER_AUTH_URL, o endereço sai da própria requisição — o caso do desenvolvimento.
  baseURL: process.env.BETTER_AUTH_URL || undefined,
  basePath: '/api/auth',
  trustedOrigins: [process.env.FRONTEND_URL || 'http://localhost:5173'],
  database: prismaAdapter(prisma, { provider: 'sqlite' }),
  // `Account` já é a conta bancária do app; a "conta" de login do Better Auth vira AuthAccount.
  account: { modelName: 'authAccount' },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
    password: {
      hash: password => bcrypt.hash(password, BCRYPT_ROUNDS),
      verify: ({ hash, password }) => bcrypt.compare(password, hash),
    },
  },
  hooks: {
    // O Better Auth aceita nome vazio no cadastro; o FinFlow sempre exigiu o nome completo.
    before: createAuthMiddleware(async ctx => {
      if (ctx.path !== '/sign-up/email') return;
      const name = ctx.body?.name;
      if (typeof name !== 'string' || !name.trim()) {
        throw new APIError('BAD_REQUEST', { code: 'NAME_REQUIRED', message: 'Nome completo é obrigatório.' });
      }
    }),
  },
  rateLimit: {
    enabled: true,
    // No banco, e não em memória: na Vercel cada instância da função teria a sua contagem (FIN-120).
    storage: 'database',
    customRules: {
      '/sign-in/email': authAttemptsRule,
      '/sign-up/email': authAttemptsRule,
      '/two-factor/*': authAttemptsRule,
    },
  },
  advanced: {
    cookiePrefix: 'finflow',
    // Mesmo formato dos ids que o app já usa (@default(uuid()) no schema).
    database: { generateId: 'uuid' },
  },
  plugins: [twoFactor({ issuer: 'FinFlow' }), bearer(), localSession()],
});

/** Confere a senha do usuário (ex.: restaurar backup). `false` também para conta sem senha. */
export async function verifyUserPassword(userId, password) {
  const credential = await prisma.authAccount.findFirst({
    where: { userId, providerId: 'credential' },
    select: { password: true },
  });
  return Boolean(credential?.password) && bcrypt.compare(password, credential.password);
}
