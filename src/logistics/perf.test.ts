import { describe, expect, it } from 'vitest';
import { addStock } from '../core/util';
import { loadOrder, unloadOrder } from './routes';
import { createTestWorld } from './testkit';

describe('performance', () => {
  it('simulates 300 vehicles on a 256×256 map within budget', () => {
    const w = createTestWorld(256);
    const { ctx, state, player } = w;
    // road lattice every 16 tiles
    for (let k = 0; k < 16; k++) {
      const c = 8 + k * 16;
      expect(ctx.services.logistics.buildNetwork(player, 'road', w.line(0, c, 255, c), 1).ok).toBe(true);
      expect(ctx.services.logistics.buildNetwork(player, 'road', w.line(c, 0, c, 255), 1).ok).toBe(true);
    }
    let vehicles = 0;
    let seed = 12345;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed % n;
    };
    const free = (x: number, y: number): boolean => {
      for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) if (state.map.building[w.idx(xx, yy)] || state.network.road[w.idx(xx, yy)]) return false;
      return true;
    };
    // a 2x2 spot touching the lattice road below-right of crossing (cx, cy)
    const spot = (): { x: number; y: number } => {
      for (;;) {
        const cx = 8 + rnd(15) * 16;
        const cy = 8 + rnd(15) * 16;
        const x = cx + 1 + rnd(13);
        const y = cy + 1;
        if (free(x, y)) return { x, y };
      }
    };
    for (let p = 0; p < 30; p++) {
      const a = spot();
      const farm = w.place('t_farm', a.x, a.y);
      const b = spot();
      const mill = w.place('t_mill', b.x, b.y);
      addStock(farm.output, 't_grain', 100_000, 0.5);
      const r = ctx.services.logistics.createRoute(player, {
        mode: 'road',
        stops: [
          { buildingId: farm.id, orders: [loadOrder()], waitFull: false, minLoad: 0 },
          { buildingId: mill.id, orders: [unloadOrder()], waitFull: false, minLoad: 0 },
        ],
      });
      if (!r.ok) throw new Error(r.reason);
      for (let k = 0; k < 10; k++) {
        const bv = ctx.services.logistics.buyVehicle(player, 't_cart', r.id);
        if (!bv.ok) throw new Error(bv.reason);
        vehicles++;
      }
    }
    expect(vehicles).toBe(300);
    let delivered = 0;
    ctx.bus.on('vehicle:delivered', (e) => (delivered += e.qty));
    // periodically drain mills so deliveries continue
    ctx.bus.on('time:day', () => {
      for (const b of Object.values(state.buildings)) if (b.typeId === 't_mill') b.input = {};
    });
    ctx.sim.advanceDays(1); // warm-up (path searches)
    const t0 = performance.now();
    const days = 30;
    ctx.sim.advanceDays(days);
    const ms = performance.now() - t0;
    const perTick = ms / (days * 10);
    // eslint-disable-next-line no-console
    console.log(`[perf] 300 vehicles, 256x256: ${perTick.toFixed(3)} ms/tick, delivered ${Math.round(delivered)}`);
    const noPath = Object.values(state.vehicles).filter((v) => v.status === 'noPath').length;
    expect(noPath).toBe(0);
    expect(delivered).toBeGreaterThan(0);
    const active = Object.values(state.vehicles).filter((v) => v.status !== 'idle' && v.status !== 'noPath').length;
    expect(active).toBe(300);
    expect(perTick).toBeLessThan(4);
  });
});

describe('construction planner performance', () => {
  it('plans a road across a 256×256 map quickly', () => {
    const w = createTestWorld(256, { water: (x, y) => x > 100 && x < 110 && y < 200 });
    const t0 = performance.now();
    const p = w.ctx.services.logistics.planNetworkPath('road', w.idx(5, 5), w.idx(250, 250));
    const ms = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[perf] planNetworkPath 256x256: ${ms.toFixed(1)} ms, ${p?.length} tiles`);
    expect(p).not.toBeNull();
    expect(ms).toBeLessThan(500);
  });
});
