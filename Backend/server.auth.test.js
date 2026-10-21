// @vitest-environment node
// FIN-033 — testes de autenticação: registro, login e validação de token.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createTestApp, TEST_JWT_SECRET } from './test/backend-test-utils.js';

describe('Autenticação', () => {
  let app;
  let cleanup;

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('auth'));
  });

  afterAll(() => cleanup());

  describe('POST /api/auth/register', () => {
    it('registra um usuário com dados válidos', async () => {
      const res = await request(app).post('/api/auth/register')
        .send({ name: 'Fulano', email: 'fulano@auth.test', password: 'senha123' });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
      expect(res.body.user.email).toBe('fulano@auth.test');
    });

    it('rejeita e-mail duplicado (FIN-014: mensagem específica, decisão consciente)', async () => {
      await request(app).post('/api/auth/register')
        .send({ name: 'Original', email: 'duplicado@auth.test', password: 'senha123' });
      const res = await request(app).post('/api/auth/register')
        .send({ name: 'Outro', email: 'duplicado@auth.test', password: 'outrasenha' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/já cadastrado/i);
    });

    it('normaliza e-mail (trim + lowercase) — duplicidade detectada mesmo com capitalização diferente (FIN-013)', async () => {
      await request(app).post('/api/auth/register')
        .send({ name: 'Original', email: 'CaseTest@Auth.Test', password: 'senha123' });
      const res = await request(app).post('/api/auth/register')
        .send({ name: 'Outro', email: '  casetest@auth.test  ', password: 'outrasenha' });
      expect(res.status).toBe(400);
    });

    it('rejeita senha curta (< 6 caracteres)', async () => {
      const res = await request(app).post('/api/auth/register')
        .send({ name: 'Fulano', email: 'senhacurta@auth.test', password: '123' });
      expect(res.status).toBe(400);
    });

    it('rejeita e-mail sem "@"', async () => {
      const res = await request(app).post('/api/auth/register')
        .send({ name: 'Fulano', email: 'nao-e-email', password: 'senha123' });
      expect(res.status).toBe(400);
    });

    it('rejeita nome vazio', async () => {
      const res = await request(app).post('/api/auth/register')
        .send({ name: '  ', email: 'semnome@auth.test', password: 'senha123' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    beforeAll(async () => {
      await request(app).post('/api/auth/register')
        .send({ name: 'Login Tester', email: 'login@auth.test', password: 'senhacorreta' });
    });

    it('login com credenciais corretas retorna token', async () => {
      const res = await request(app).post('/api/auth/login')
        .send({ email: 'login@auth.test', password: 'senhacorreta' });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
    });

    it('login com senha incorreta retorna 400 com mensagem genérica (sem enumerar)', async () => {
      const res = await request(app).post('/api/auth/login')
        .send({ email: 'login@auth.test', password: 'senhaerrada' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/credenciais inválidas/i);
    });

    it('login com e-mail inexistente retorna a MESMA mensagem genérica que senha incorreta (sem enumerar contas)', async () => {
      const res = await request(app).post('/api/auth/login')
        .send({ email: 'naoexiste@auth.test', password: 'qualquer' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/credenciais inválidas/i);
    });
  });

  describe('Proteção de rotas (JWT)', () => {
    it('acesso a rota protegida sem token retorna 401', async () => {
      const res = await request(app).get('/api/accounts');
      expect(res.status).toBe(401);
    });

    it('acesso com token malformado retorna 403', async () => {
      const res = await request(app).get('/api/accounts').set('Authorization', 'Bearer nao-e-um-jwt');
      expect(res.status).toBe(403);
    });

    it('acesso com token assinado com outro segredo retorna 403 (garante que JWT_SECRET é realmente verificado)', async () => {
      const forged = jwt.sign({ userId: 'qualquer-id' }, 'segredo-errado-diferente-do-real');
      const res = await request(app).get('/api/accounts').set('Authorization', `Bearer ${forged}`);
      expect(res.status).toBe(403);
    });

    it('acesso com token expirado retorna 403', async () => {
      const expired = jwt.sign({ userId: 'qualquer-id' }, TEST_JWT_SECRET, { expiresIn: -1 });
      const res = await request(app).get('/api/accounts').set('Authorization', `Bearer ${expired}`);
      expect(res.status).toBe(403);
    });

    it('token válido dá acesso normalmente', async () => {
      const reg = await request(app).post('/api/auth/register')
        .send({ name: 'Acesso Valido', email: 'acessovalido@auth.test', password: 'senha123' });
      const res = await request(app).get('/api/accounts').set('Authorization', `Bearer ${reg.body.token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
