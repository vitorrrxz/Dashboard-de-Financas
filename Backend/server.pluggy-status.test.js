// @vitest-environment node
// FIN-041 — tratamento do status de item Pluggy que indica necessidade de reautenticação.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp } from './test/backend-test-utils.js';

describe('pluggyReauthMessage (FIN-041)', () => {
  let pluggyReauthMessage;
  let cleanup;

  beforeAll(async () => {
    const app = await createTestApp('pluggy_status');
    cleanup = app.cleanup;
    ({ pluggyReauthMessage } = await import('./server.js'));
  });

  afterAll(() => cleanup());

  it('LOGIN_ERROR retorna mensagem orientando reconexão', () => {
    expect(pluggyReauthMessage('LOGIN_ERROR')).toMatch(/reconecte/i);
  });

  it('OUTDATED retorna mensagem orientando nova tentativa', () => {
    expect(pluggyReauthMessage('OUTDATED')).toMatch(/tente novamente|reconecte/i);
  });

  it('status normais (UPDATED, UPDATING, MERGING) não retornam mensagem', () => {
    expect(pluggyReauthMessage('UPDATED')).toBeNull();
    expect(pluggyReauthMessage('UPDATING')).toBeNull();
    expect(pluggyReauthMessage('MERGING')).toBeNull();
  });
});
