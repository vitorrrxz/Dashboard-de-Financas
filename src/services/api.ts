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
    throw new Error(err.error || 'Erro na API');
  }
  return res.json();
}
