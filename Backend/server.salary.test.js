// @vitest-environment node
// Salário manual — GET/PUT /api/auth/salary.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from './test/backend-test-utils.js';

describe('/api/auth/salary', () => {
  let app;
  let cleanup;
  let token;

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('salary'));
    const reg = await request(app).post('/api/auth/register')
      .send({ name: 'Usuario', email: 'user@salary.test', password: 'senha123' });
    expect(reg.status).toBe(200);
    token = reg.body.token;
  });

  afterAll(() => cleanup());

  it('começa zerado e mensal', async () => {
    const res = await request(app).get('/api/auth/salary').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ salaryCents: 0, salaryFrequency: 'monthly' });
  });

  it('salva salário quinzenal e devolve o valor salvo', async () => {
    const put = await request(app).put('/api/auth/salary').set('Authorization', `Bearer ${token}`)
      .send({ salaryCents: 250000, salaryFrequency: 'biweekly' });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ salaryCents: 250000, salaryFrequency: 'biweekly' });
    const get = await request(app).get('/api/auth/salary').set('Authorization', `Bearer ${token}`);
    expect(get.body).toEqual({ salaryCents: 250000, salaryFrequency: 'biweekly' });
  });

  it('rejeita valor negativo e periodicidade desconhecida', async () => {
    const neg = await request(app).put('/api/auth/salary').set('Authorization', `Bearer ${token}`)
      .send({ salaryCents: -1, salaryFrequency: 'monthly' });
    expect(neg.status).toBe(400);
    const freq = await request(app).put('/api/auth/salary').set('Authorization', `Bearer ${token}`)
      .send({ salaryCents: 100, salaryFrequency: 'weekly' });
    expect(freq.status).toBe(400);
  });

  it('exige autenticação', async () => {
    const res = await request(app).get('/api/auth/salary');
    expect(res.status).toBe(401);
  });
});
