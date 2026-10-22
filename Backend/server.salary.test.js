// @vitest-environment node
// Salário manual — GET/PUT /api/profile/salary.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from './test/backend-test-utils.js';

describe('/api/profile/salary', () => {
  let app;
  let cleanup;
  let token;

  beforeAll(async () => {
    ({ app, cleanup } = await createTestApp('salary'));
    const reg = await request(app).post('/api/auth/sign-up/email')
      .send({ name: 'Usuario', email: 'user@salary.test', password: 'senha123' });
    expect(reg.status).toBe(200);
    token = reg.body.token;
  });

  afterAll(() => cleanup());

  it('começa zerado e mensal', async () => {
    const res = await request(app).get('/api/profile/salary').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ salaryCents: 0, salaryFrequency: 'monthly', salaryPayDay: 15, bonusCents: 0, bonusHalf: 1, bonusMonth: null });
  });

  it('salva salário quinzenal e devolve o valor salvo', async () => {
    const put = await request(app).put('/api/profile/salary').set('Authorization', `Bearer ${token}`)
      .send({ salaryCents: 250000, salaryFrequency: 'biweekly', salaryPayDay: 5, bonusCents: 50000, bonusHalf: 2, bonusMonth: '2026-10' });
    expect(put.status).toBe(200);
    const saved = { salaryCents: 250000, salaryFrequency: 'biweekly', salaryPayDay: 5, bonusCents: 50000, bonusHalf: 2, bonusMonth: '2026-10' };
    expect(put.body).toEqual(saved);
    const get = await request(app).get('/api/profile/salary').set('Authorization', `Bearer ${token}`);
    expect(get.body).toEqual(saved);
  });

  it('rejeita valor negativo e periodicidade desconhecida', async () => {
    const neg = await request(app).put('/api/profile/salary').set('Authorization', `Bearer ${token}`)
      .send({ salaryCents: -1, salaryFrequency: 'monthly' });
    expect(neg.status).toBe(400);
    const freq = await request(app).put('/api/profile/salary').set('Authorization', `Bearer ${token}`)
      .send({ salaryCents: 100, salaryFrequency: 'weekly' });
    expect(freq.status).toBe(400);
    const day = await request(app).put('/api/profile/salary').set('Authorization', `Bearer ${token}`)
      .send({ salaryCents: 100, salaryFrequency: 'biweekly', salaryPayDay: 16 });
    expect(day.status).toBe(400);
    const half = await request(app).put('/api/profile/salary').set('Authorization', `Bearer ${token}`)
      .send({ salaryCents: 100, salaryFrequency: 'biweekly', bonusCents: 100, bonusHalf: 3 });
    expect(half.status).toBe(400);
  });

  it('exige autenticação', async () => {
    const res = await request(app).get('/api/profile/salary');
    expect(res.status).toBe(401);
  });
});
