// Base URL da API + cliente fetch único do frontend (ver FIN-025/FIN-027 em
// docs/BACKLOG_DETAIL.md). Antes desta tarefa, `http://localhost:3001` estava hardcoded
// em 3 arquivos (App.tsx, AuthForm.tsx, PluggyConnectButton.tsx), cada um com sua própria
// cópia quase idêntica de `fetchAPI` — impossível rodar o frontend contra outro host
// (staging, produção) sem editar código-fonte.
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface ApiFetchOptions {
  method?: string;
  body?: unknown;
  // Ausente/`null` para rotas públicas (login, registro) — presente para as demais.
  token?: string | null;
}

// Carrega o status HTTP e o corpo cru da resposta de erro — permite ao chamador
// diferenciar tipos de falha (ex. FIN-041: 409 = reautenticação Pluggy necessária) sem
// quebrar o código existente que só lê `.message` (todo `Error` tem essa propriedade).
export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(message: string, status: number, body: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch<T = unknown>(endpoint: string, options: ApiFetchOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = options;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(err.error || 'Erro na API', res.status, err);
  }
  return res.json();
}
