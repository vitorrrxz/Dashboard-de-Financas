import { describe, it, expect } from 'vitest';
import { niceTicks } from './chart';

describe('niceTicks', () => {
  it('passos redondos, com o zero e uma marca além do máximo', () => {
    expect(niceTicks([2300, -850])).toEqual([-1000, 0, 1000, 2000, 3000]);
    expect(niceTicks([400, 1000])).toEqual([0, 250, 500, 750, 1000, 1250]);
  });

  it('só negativos, ou tudo zero', () => {
    expect(niceTicks([-1800, -200])).toEqual([-2000, -1500, -1000, -500, 0]);
    expect(niceTicks([0, 0])).toEqual([0]);
  });
});
