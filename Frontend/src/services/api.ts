// Base URL da API + cliente fetch único do frontend (ver FIN-025/FIN-027 em
// docs/BACKLOG_DETAIL.md). Antes desta tarefa, `http://localhost:3001` estava hardcoded
// em 3 arquivos (App.tsx, AuthForm.tsx, PluggyConnectButton.tsx), cada um com sua própria
// cópia quase idêntica de `fetchAPI` — impossível rodar o frontend contra outro host
// (staging, produção) sem editar código-fonte.
// Vazia (`VITE_API_URL=""`), a API é a da própria origem da página: o build servido pela API no
// contêiner (FIN-108). Por isso `??`, e não `||` — o valor vazio não cai no padrão do desenvolvimento.
export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export interface ApiFetchOptions {
  method?: string;
  body?: unknown;
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
  const { method = 'GET', body } = options;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  // FIN-121 — a sessão vai no cookie httpOnly do Better Auth (ver services/auth.ts). `include`, e não
  // o padrão `same-origin`: no desenvolvimento a API (:3001) está em outra origem que o Vite (:5173).
  const res = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const raw: unknown = await res.json().catch(() => ({}));
    // O corpo de erro pode não ser um objeto (`null`, string, array, número) se o servidor
    // responder algo inesperado (proxy, erro 5xx fora do nosso controle) — sem normalizar,
    // `err.error` explodiria com "Cannot read properties of null/undefined" antes mesmo de
    // chegar ao catch do chamador (ex.: PluggyConnectButton checando `err.status === 409`).
    const err: Record<string, unknown> = (raw && typeof raw === 'object' && !Array.isArray(raw))
      ? raw as Record<string, unknown>
      : {};
    throw new ApiError((typeof err.error === 'string' && err.error) || 'Erro na API', res.status, err);
  }
  return res.json();
}
