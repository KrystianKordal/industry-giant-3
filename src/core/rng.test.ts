import { describe, expect, it } from 'vitest';
import { createRng, hashSeed, nextFloat, rng } from './rng';

describe('rng', () => {
  it('is deterministic for the same seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const sa = Array.from({ length: 50 }, () => nextFloat(a));
    const sb = Array.from({ length: 50 }, () => nextFloat(b));
    expect(sa).toEqual(sb);
    expect(a.s).toBe(b.s);
  });

  it('differs for different seeds and stays in [0,1)', () => {
    const a = createRng(1);
    const b = createRng(2);
    const va = Array.from({ length: 1000 }, () => nextFloat(a));
    expect(va.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(nextFloat(b)).not.toBe(va[0]);
  });

  it('continues identically after JSON roundtrip of its state', () => {
    const a = createRng(777);
    for (let i = 0; i < 10; i++) nextFloat(a);
    const b = JSON.parse(JSON.stringify(a));
    expect(nextFloat(a)).toBe(nextFloat(b));
  });

  it('wrapper helpers respect bounds', () => {
    const r = rng(createRng(hashSeed(42, 'test')));
    for (let i = 0; i < 500; i++) {
      const n = r.int(3, 7);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
    }
    expect(r.shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(hashSeed(1, 'a')).toBe(hashSeed(1, 'a'));
    expect(hashSeed(1, 'a')).not.toBe(hashSeed(1, 'b'));
  });
});
