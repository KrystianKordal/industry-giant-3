import { describe, expect, it } from 'vitest';
import { findBuildingPath, pathLength, searchNetwork } from './pathfinding';
import { createTestWorld } from './testkit';

describe('pathfinding', () => {
  it('finds the shortest road path on a grid', () => {
    const w = createTestWorld();
    const { ctx, player, state } = w;
    // square loop 5..15 plus a middle shortcut
    for (const [x0, y0, x1, y1] of [
      [5, 5, 15, 5],
      [15, 5, 15, 15],
      [5, 15, 15, 15],
      [5, 5, 5, 15],
      [5, 10, 15, 10],
    ] as const)
      ctx.services.logistics.buildNetwork(player, 'road', w.line(x0, y0, x1, y1), 1);
    const p = ctx.services.logistics.findPath('road', w.idx(5, 5), w.idx(15, 15));
    expect(p).not.toBeNull();
    expect(p!.length).toBe(21); // manhattan 20 + start
    for (const t of p!) expect(state.network.road[t]).toBeGreaterThan(0);
    // unreachable
    ctx.services.logistics.buildNetwork(player, 'road', w.line(30, 30, 35, 30), 1);
    expect(ctx.services.logistics.findPath('road', w.idx(5, 5), w.idx(35, 30))).toBeNull();
  });

  it('invalidates cached paths when the network changes', () => {
    const w = createTestWorld();
    const { ctx, player } = w;
    ctx.services.logistics.buildNetwork(player, 'road', w.line(2, 2, 20, 2), 1);
    expect(ctx.services.logistics.findPath('road', w.idx(2, 2), w.idx(20, 2))).not.toBeNull();
    ctx.services.logistics.removeNetwork(player, 'road', [w.idx(10, 2)]);
    expect(ctx.services.logistics.findPath('road', w.idx(2, 2), w.idx(20, 2))).toBeNull();
    ctx.services.logistics.buildNetwork(player, 'road', w.line(9, 2, 11, 2), 1);
    expect(ctx.services.logistics.findPath('road', w.idx(2, 2), w.idx(20, 2))).not.toBeNull();
  });

  it('connects buildings through adjacent road tiles', () => {
    const w = createTestWorld();
    const { ctx, player } = w;
    const farm = w.place('t_farm', 4, 4); // 4..5
    const mill = w.place('t_mill', 20, 4); // 20..21
    expect(ctx.services.logistics.isConnected('road', farm.id, mill.id)).toBe(false);
    ctx.services.logistics.buildNetwork(player, 'road', w.line(6, 4, 19, 4), 1);
    expect(ctx.services.logistics.isConnected('road', farm.id, mill.id)).toBe(true);
    const p = findBuildingPath(ctx, 'road', farm, mill)!;
    expect(p[0]).toBe(w.idx(6, 4));
    expect(p[p.length - 1]).toBe(w.idx(19, 4));
  });

  it('routes ships over water without cutting corners', () => {
    const w = createTestWorld(40, { water: (x, y) => y >= 10 && y <= 25 && x >= 5 && x <= 35 && !(x === 20 && y < 22) });
    const { ctx, state } = w;
    const p = searchNetwork(ctx, 'water', [w.idx(6, 12)], [w.idx(34, 12)]);
    expect(p).not.toBeNull();
    for (const t of p!) expect(ctx.data.terrain[state.map.terrain[t]!]!.isWater).toBe(true);
    // must go around the pier at x=20 (y 10..21)
    expect(p!.some((t) => t % state.map.width === 20 && Math.floor(t / state.map.width) >= 22)).toBe(true);
    expect(pathLength(state.map.width, p!)).toBeGreaterThan(28);
  });
});
