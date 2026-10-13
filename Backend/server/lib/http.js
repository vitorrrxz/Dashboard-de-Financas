// Loga o erro completo no servidor e retorna uma mensagem genérica ao cliente — nunca
// `error.message`/detalhes internos do Prisma/Node, que podem vazar schema, nomes de
// coluna etc. (ver FIN-011 em docs/BACKLOG_DETAIL.md).
export function sendInternalError(res, error, publicMessage = 'Erro interno do servidor.') {
  console.error(publicMessage, error);
  res.status(500).json({ error: publicMessage });
}

/* -------------------------------------------------------------------------- */
/*                        VALIDAÇÃO DE PAYLOAD (FIN-008)                      */
/* -------------------------------------------------------------------------- */
// Antes desta tarefa, as rotas de CRUD (accounts/transactions/debts) gravavam
// `req.body` quase sem checagem, permitindo dados financeiros inconsistentes
// (ex.: `totalInstallments: 0`, causando divisão por zero no frontend). Cada rota
// agora valida o payload com um schema Zod antes de tocar o banco.
export function validateBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues.map(i => i.message).join(' ') || 'Dados inválidos.';
    return { ok: false, message };
  }
  return { ok: true, data: result.data };
}
