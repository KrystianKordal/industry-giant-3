import { describe, expect, it } from 'vitest';
import type { Blueprint } from '../core/types';
import { chainTiles, rotateBlueprint } from '../input/tools/blueprint';
import { loanPayment } from './analytics';

describe('ui helpers', () => {
  it('loanPayment: annuity and zero rate', () => {
    expect(loanPayment(12000, 0, 12)).toBeCloseTo(1000);
    const p = loanPayment(100000, 0.12, 12);
    expect(p).toBeGreaterThan(8800);
    expect(p).toBeLessThan(8900);
  });

  it('rotateBlueprint keeps items inside the rotated box', () => {
    const bp: Blueprint = {
      id: 'b',
      name: 'x',
      w: 5,
      h: 3,
      items: [{ typeId: 'a', dx: 0, dy: 0, rotation: 0, recipeId: null }],
      network: [{ dx: 4, dy: 2, road: 1, rail: 0 }],
      createdDay: 0,
    };
    const fp = (_t: string, r: number): { w: number; h: number } => (r % 2 ? { w: 2, h: 3 } : { w: 3, h: 2 });
    for (let r = 0; r < 4; r++) {
      const rb = rotateBlueprint(bp, r, fp);
      expect(rb.w).toBe(r % 2 ? 3 : 5);
      for (const it of rb.items) {
        expect(it.dx).toBeGreaterThanOrEqual(0);
        expect(it.dy).toBeGreaterThanOrEqual(0);
        expect(it.dx + it.w).toBeLessThanOrEqual(rb.w);
        expect(it.dy + it.h).toBeLessThanOrEqual(rb.h);
      }
      for (const n of rb.network) {
        expect(n.dx).toBeLessThan(rb.w);
        expect(n.dy).toBeLessThan(rb.h);
      }
    }
    // four rotations = identity
    const back = rotateBlueprint(bp, 4, fp);
    expect(back.items[0]).toMatchObject({ dx: 0, dy: 0, rotation: 0 });
  });

  it('chainTiles splits into 4-adjacent chains covering all tiles', () => {
    const W = 10;
    // an L shape plus an isolated tile
    const tiles = [0, 1, 2, 12, 22, 55];
    const chains = chainTiles(tiles, W);
    const covered = new Set(chains.flat());
    for (const t of tiles) expect(covered.has(t)).toBe(true);
    for (const ch of chains)
      for (let i = 1; i < ch.length; i++) {
        const a = ch[i - 1]!;
        const b = ch[i]!;
        expect(Math.abs((a % W) - (b % W)) + Math.abs(Math.floor(a / W) - Math.floor(b / W))).toBe(1);
      }
  });
});
