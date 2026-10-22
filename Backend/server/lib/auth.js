import './env.js';
import rateLimit from 'express-rate-limit';
import { fromNodeHeaders } from 'better-auth/node';
import { auth, TWO_FACTOR_REQUIRED } from './betterAuth.js';

// FIN-121 — exige uma sessão válida do Better Auth: o cookie de sessão (navegador) ou o token dela
// no cabeçalho `Authorization: Bearer` (plugin bearer). As rotas continuam lendo `req.user.userId`,
// como antes do Better Auth. Sessão ausente, expirada ou encerrada: 401. FIN-123: com a verificação em
// duas etapas obrigatória e ainda não ativada, 403 com `code: 'TWO_FACTOR_SETUP_REQUIRED'`.
export const requireAuth = async (req, res, next) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) return res.status(401).json({ error: 'Acesso negado: faça login novamente.' });
    if (TWO_FACTOR_REQUIRED && !session.user.twoFactorEnabled) {
      return res.status(403).json({ error: 'Ative a verificação em duas etapas para continuar.', code: 'TWO_FACTOR_SETUP_REQUIRED' });
    }
    req.user = { userId: session.user.id, name: session.user.name, email: session.user.email };
    next();
  } catch (error) {
    next(error);
  }
};

// Rate limit nas rotas fora do Better Auth que conferem a senha (restaurar backup) — mitiga força
// bruta (ver FIN-007 em docs/BACKLOG_DETAIL.md). O login e o cadastro têm o limite do próprio Better
// Auth (server/lib/betterAuth.js). Limite configurável via env var só para não estourar em testes de
// integração (FIN-031 a FIN-033) — em produção, sem AUTH_RATE_LIMIT definida, o limite continua 10.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: Number(process.env.AUTH_RATE_LIMIT) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});
