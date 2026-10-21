// @vitest-environment node
// FIN-108 — no contêiner, a API serve o build do frontend na mesma origem (`FRONTEND_DIR`): a página, os
// arquivos e o index.html nos caminhos da SPA, sem engolir /api; e a CSP libera o script de tema embutido
// (pelo hash, com o CRLF de um checkout no Windows) e o widget da Pluggy.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createTestApp } from './test/backend-test-utils.js';

const THEME_SCRIPT = "\r\n      document.documentElement.dataset.theme = 'dark';\r\n    ";
const INDEX_HTML = `<!doctype html>\r\n<html><head><script>${THEME_SCRIPT}</script>`
  + '<script src="https://cdn.pluggy.ai/pluggy-connect/v2.8.2/pluggy-connect.js"></script>'
  + '<script type="module" crossorigin src="/assets/app.js"></script></head>'
  + '<body><div id="root">finflow-index</div></body></html>';
// Como o navegador calcula: sobre o script com as quebras de linha em LF.
const THEME_HASH = `'sha256-${crypto.createHash('sha256').update(THEME_SCRIPT.replace(/\r\n/g, '\n')).digest('base64')}'`;

describe('frontend servido pela API (FIN-108)', () => {
  let app;
  let cleanup;
  let dir;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finflow-dist-'));
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'index.html'), INDEX_HTML);
    fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log("finflow-asset");');
    ({ app, cleanup } = await createTestApp('frontend', { frontendDir: dir }));
  });

  afterAll(async () => {
    await cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a raiz e os caminhos da SPA recebem o index.html', async () => {
    for (const url of ['/', '/transacoes', '/qualquer/tela']) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(200);
      expect(res.headers['content-type'], url).toMatch(/^text\/html/);
      expect(res.text, url).toBe(INDEX_HTML);
    }
  });

  it('os arquivos do build saem do disco; arquivo inexistente dá 404, e não a página', async () => {
    const asset = await request(app).get('/assets/app.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['content-type']).toMatch(/javascript/);
    expect(asset.text).toBe('console.log("finflow-asset");');

    const missing = await request(app).get('/assets/nao-existe.js');
    expect(missing.status).toBe(404);
    expect(missing.text).not.toContain('finflow-index');
  });

  it('os caminhos de /api continuam com a API', async () => {
    const me = await request(app).get('/api/auth/me');
    expect(me.status).toBe(401);
    expect(me.body.error).toMatch(/token/i);

    for (const url of ['/api', '/api/nao-existe', '/API/nao-existe']) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(404);
      expect(res.text, url).not.toContain('finflow-index');
    }
  });

  it('a CSP libera o script de tema pelo hash e o widget da Pluggy, sem forçar HTTPS', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    const directives = res.headers['content-security-policy'].split(';').map(d => d.trim());
    expect(directives).toContain(`script-src 'self' https://cdn.pluggy.ai ${THEME_HASH}`);
    expect(directives).toContain('frame-src https://connect.pluggy.ai');
    // O resto do padrão do helmet continua valendo.
    expect(directives).toContain("default-src 'self'");
    expect(directives).toContain("script-src-attr 'none'");
    expect(directives.some(d => d.startsWith('upgrade-insecure-requests'))).toBe(false);
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
  });
});
