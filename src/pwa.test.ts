// FIN-082 — registro do service worker.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerServiceWorker } from './pwa';

function stubServiceWorker(register: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true });
}

describe('registerServiceWorker (FIN-082)', () => {
  afterEach(() => {
    // Remove o stub: o jsdom não tem service worker.
    Reflect.deleteProperty(navigator, 'serviceWorker');
    vi.restoreAllMocks();
  });

  it('em produção, registra /sw.js depois do load da página', () => {
    const register = vi.fn().mockResolvedValue({});
    stubServiceWorker(register);
    registerServiceWorker(true);
    expect(register).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('load'));
    expect(register).toHaveBeenCalledWith('/sw.js');
  });

  it('fora de produção não registra', () => {
    const register = vi.fn().mockResolvedValue({});
    stubServiceWorker(register);
    registerServiceWorker(false);
    window.dispatchEvent(new Event('load'));
    expect(register).not.toHaveBeenCalled();
  });

  it('navegador sem service worker: não faz nada e não quebra', () => {
    expect('serviceWorker' in navigator).toBe(false);
    expect(() => registerServiceWorker(true)).not.toThrow();
    window.dispatchEvent(new Event('load'));
  });

  it('falha no registro vai para o console, sem rejeição solta', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const register = vi.fn().mockRejectedValue(new Error('SecurityError'));
    stubServiceWorker(register);
    registerServiceWorker(true);
    window.dispatchEvent(new Event('load'));
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Falha ao registrar o service worker:', expect.any(Error)));
  });
});
