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

// FIN-122 — login com Google, GitHub e Microsoft. Cada provedor só liga com as duas credenciais do
// app OAuth dele no .env; sem elas, fica de fora (e o botão nem aparece na tela de login).
const SOCIAL_PROVIDERS = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    prompt: 'select_account',
  },
  github: {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  },
  microsoft: {
    clientId: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    // "common": contas pessoais (Outlook, Hotmail) e de trabalho/escola.
    tenantId: process.env.MICROSOFT_TENANT_ID || 'common',
    prompt: 'select_account',
  },
};
export const enabledSocialProviders = Object.keys(SOCIAL_PROVIDERS)
  .filter(id => SOCIAL_PROVIDERS[id].clientId && SOCIAL_PROVIDERS[id].clientSecret);

// A tela de login pergunta quais provedores mostrar.
const socialProvidersList = () => ({
  id: 'social-providers-list',
  endpoints: {
    socialProvidersList: createAuthEndpoint('/social-providers', { method: 'GET' },
      async ctx => ctx.json({ providers: enabledSocialProviders })),
  },
});

const FRONTEND_ORIGIN = new URL(process.env.FRONTEND_URL || 'http://localhost:5173').origin;
// FIN-122 — para onde o login social pode mandar a pessoa depois do provedor: caminho relativo ou o
// próprio app. Sem isto, um link com callbackURL de outro site passaria pelo login de verdade e
// terminaria numa página falsa (redirecionamento aberto) — o Better Auth só confere a URL quando a
// requisição já traz cookies.
const CALLBACK_FIELDS = ['callbackURL', 'errorCallbackURL', 'newUserCallbackURL'];
function isAppUrl(value) {
  if (value === undefined) return true;
  if (typeof value !== 'string') return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try {
    return new URL(value).origin === FRONTEND_ORIGIN;
  } catch {
    return false;
  }
}

export const auth = betterAuth({
  appName: 'FinFlow',
  secret: BETTER_AUTH_SECRET,
  // Sem BETTER_AUTH_URL, o endereço sai da própria requisição — o caso do desenvolvimento.
  baseURL: process.env.BETTER_AUTH_URL || undefined,
  basePath: '/api/auth',
  trustedOrigins: [FRONTEND_ORIGIN],
  // Erro no retorno do provedor (login cancelado, state inválido...): volta para a tela do app com
  // ?error=<código>, que ela traduz, em vez da página de erro do Better Auth.
  onAPIError: { errorURL: `${FRONTEND_ORIGIN}/` },
  database: prismaAdapter(prisma, { provider: 'sqlite' }),
  // `Account` já é a conta bancária do app; a "conta" de login do Better Auth vira AuthAccount.
  account: { modelName: 'authAccount' },
  socialProviders: Object.fromEntries(enabledSocialProviders.map(id => [id, SOCIAL_PROVIDERS[id]])),
  // Login social com o e-mail de uma conta que já existe NÃO entra nela sozinho: o Better Auth só junta
  // as duas se o e-mail da conta daqui estiver verificado (requireLocalEmailVerified, padrão), e o
  // FinFlow não verifica e-mails no cadastro. Sem essa trava, alguém que cadastrasse o e-mail de outra
  // pessoa com uma senha qualquer ficaria com a conta quando a dona entrasse pelo Google. Quem já tem
  // conta conecta os provedores logado, em Configurações (linkSocial) — e aí pode ser um e-mail
  // diferente, porque a pessoa provou que é dona das duas contas.
  accountLinking: { enabled: true, allowDifferentEmails: true },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
    password: {
      hash: password => bcrypt.hash(password, BCRYPT_ROUNDS),
      verify: ({ hash, password }) => bcrypt.compare(password, hash),
    },
  },
  hooks: {
    before: createAuthMiddleware(async ctx => {
      if (ctx.path === '/sign-in/social' || ctx.path === '/link-social') {
        if (!CALLBACK_FIELDS.every(field => isAppUrl(ctx.body?.[field]))) {
          throw new APIError('FORBIDDEN', { code: 'INVALID_CALLBACK_URL', message: 'Endereço de retorno não permitido.' });
        }
        return;
      }
      // O Better Auth aceita nome vazio no cadastro; o FinFlow sempre exigiu o nome completo.
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
      '/sign-in/social': authAttemptsRule,
      '/link-social': authAttemptsRule,
      '/two-factor/*': authAttemptsRule,
    },
  },
  advanced: {
    cookiePrefix: 'finflow',
    // Mesmo formato dos ids que o app já usa (@default(uuid()) no schema).
    database: { generateId: 'uuid' },
  },
  plugins: [twoFactor({ issuer: 'FinFlow' }), bearer(), localSession(), socialProvidersList()],
});

/** Confere a senha do usuário (ex.: restaurar backup). `false` também para conta sem senha. */
export async function verifyUserPassword(userId, password) {
  const credential = await prisma.authAccount.findFirst({
    where: { userId, providerId: 'credential' },
    select: { password: true },
  });
  return Boolean(credential?.password) && bcrypt.compare(password, credential.password);
}
