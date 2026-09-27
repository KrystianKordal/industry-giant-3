import { describe, expect, it } from 'vitest';
import { startNewGame } from '../../core/lifecycle';
import { addMoney } from '../../core/money';
import { createSimContext } from '../../core/qa';
import { anchorFor } from './build';
import { computeSuitability, nearestSuitable } from './suitability';

describe('build-site suitability map', () => {
  it('matches economy.checkPlacement for every cursor tile (ignoring cash)', () => {
    const ctx = createSimContext();
    startNewGame(ctx, { seed: 41, mapWidth: 64, mapHeight: 64, rivals: 1 });
    ctx.sim.advanceDays(60); // some rival buildings / roads on the map
    const pid = ctx.state.playerCompanyId;
    addMoney(ctx, pid, 1e9, 'otherIncome');
    const W = ctx.state.map.width;
    for (const typeId of ['farm_grain', 'coal_mine', 'harbor', 'shop_food', 'bakery']) {
      const def = ctx.data.buildings[typeId];
      if (!def) continue;
      for (const rot of [0, 1] as const) {
        const s = computeSuitability(ctx, pid, typeId, rot);
        let mismatches = 0;
        for (let i = 0; i < s.mask.length; i++) {
          const tx = i % W;
          const ty = (i - tx) / W;
          const a = anchorFor(def, rot, tx, ty);
          const ok = ctx.services.economy.checkPlacement(pid, typeId, a.x, a.y, rot).ok;
          if (ok !== s.mask[i]! > 0) mismatches++;
        }
        expect(mismatches, `${typeId} rot ${rot}`).toBe(0);
        if (typeId === 'farm_grain' || typeId === 'shop_food') expect(s.count).toBeGreaterThan(0);
        const spot = nearestSuitable(s, 10, 10);
        if (s.count) {
          expect(spot).not.toBeNull();
          expect(s.mask[spot!.y * W + spot!.x]).toBeGreaterThan(0);
        } else expect(spot).toBeNull();
      }
    }
  });
});
