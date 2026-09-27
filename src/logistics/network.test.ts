import { describe, expect, it } from 'vitest';
import { Dir, TileFlag } from '../core/types';
import { REFUND_RATE, ROAD_COST } from './constants';
import { createTestWorld } from './testkit';

describe('network construction', () => {
  it('builds a road, charges money and sets connection masks', () => {
    const w = createTestWorld();
    const { ctx, state, player } = w;
    const cash0 = state.companies[player]!.cash;
    const tiles = w.line(5, 5, 10, 5);
    const est = ctx.services.logistics.estimateNetwork(player, 'road', tiles, 1);
    expect(est.ok).toBe(true);
    const res = ctx.services.logistics.buildNetwork(player, 'road', tiles, 1);
    expect(res.ok).toBe(true);
    if (!res.ok || !est.ok) return;
    expect(res.cost).toBe(est.cost);
    expect(res.cost).toBe(ROAD_COST[1] * 6);
    expect(state.companies[player]!.cash).toBe(cash0 - res.cost);
    expect(state.network.road[w.idx(7, 5)]).toBe(1);
    expect(state.network.roadConn[w.idx(7, 5)]).toBe(Dir.E | Dir.W);
    expect(state.network.roadConn[w.idx(5, 5)]).toBe(Dir.E);
    // a crossing road connects automatically
    ctx.services.logistics.buildNetwork(player, 'road', w.line(7, 3, 7, 7), 1);
    expect(state.network.roadConn[w.idx(7, 5)]).toBe(Dir.N | Dir.E | Dir.S | Dir.W);
    // rebuilding existing road is free
    const again = ctx.services.logistics.buildNetwork(player, 'road', tiles, 1);
    expect(again.ok && again.cost).toBe(0);
  });

  it('refunds part of the cost on bulldoze and clears masks', () => {
    const w = createTestWorld();
    const { ctx, state, player } = w;
    const tiles = w.line(5, 5, 9, 5);
    const b = ctx.services.logistics.buildNetwork(player, 'road', tiles, 1);
    const cash1 = state.companies[player]!.cash;
    const r = ctx.services.logistics.removeNetwork(player, 'road', [w.idx(9, 5)]);
    expect(r.ok).toBe(true);
    if (!r.ok || !b.ok) return;
    expect(-r.cost).toBe(Math.round(ROAD_COST[1] * REFUND_RATE));
    expect(state.companies[player]!.cash).toBe(cash1 + Math.round(ROAD_COST[1] * REFUND_RATE));
    expect(state.network.road[w.idx(9, 5)]).toBe(0);
    expect(state.network.roadConn[w.idx(8, 5)]).toBe(Dir.W);
    // cannot remove infrastructure of another company
    const other = ctx.services.logistics.removeNetwork(player + 99, 'road', [w.idx(6, 5)]);
    expect(other.ok).toBe(false);
  });

  it('rejects building over buildings and locked levels', () => {
    const w = createTestWorld();
    const { ctx, player } = w;
    w.place('t_mill', 10, 10);
    const r = ctx.services.logistics.buildNetwork(player, 'road', w.line(8, 10, 12, 10), 1);
    expect(r.ok).toBe(false);
    const hw = ctx.services.logistics.buildNetwork(player, 'road', w.line(1, 1, 3, 1), 3);
    expect(hw.ok).toBe(false);
  });

  it('bridges water only in straight lines and at a higher price', () => {
    const w = createTestWorld(32, { water: (x) => x >= 10 && x <= 12 });
    const { ctx, state, player } = w;
    const straight = w.line(8, 5, 14, 5);
    const est = ctx.services.logistics.estimateNetwork(player, 'road', straight, 1);
    expect(est.ok).toBe(true);
    if (est.ok) expect(est.cost).toBeGreaterThan(ROAD_COST[1] * 7 * 2);
    const res = ctx.services.logistics.buildNetwork(player, 'road', straight, 1);
    expect(res.ok).toBe(true);
    expect(state.map.flags[w.idx(11, 5)]! & TileFlag.Bridge).toBeTruthy();
    // turning on water is not allowed
    const bent = [w.idx(9, 8), w.idx(10, 8), w.idx(11, 8), w.idx(11, 9), w.idx(12, 9), w.idx(13, 9)];
    const bad = ctx.services.logistics.estimateNetwork(player, 'road', bent, 1);
    expect(bad.ok).toBe(false);
    // a bridge must land
    const hanging = ctx.services.logistics.estimateNetwork(player, 'road', w.line(8, 12, 11, 12), 1);
    expect(hanging.ok).toBe(false);
  });

  it('connects rails only along the drawn path', () => {
    const w = createTestWorld();
    const { ctx, state, player } = w;
    ctx.services.logistics.buildNetwork(player, 'rail', w.line(2, 10, 20, 10), 1);
    ctx.services.logistics.buildNetwork(player, 'rail', w.line(10, 2, 10, 20), 1);
    // crossing without a junction
    expect(state.network.railConn[w.idx(10, 10)]).toBe(Dir.N | Dir.E | Dir.S | Dir.W);
    const path = ctx.services.logistics.findPath('rail', w.idx(2, 10), w.idx(20, 10));
    expect(path).not.toBeNull();
    // a branch drawn from the side joins at its endpoint
    ctx.services.logistics.buildNetwork(player, 'rail', w.line(15, 11, 15, 15), 1);
    expect(state.network.railConn[w.idx(15, 10)]! & Dir.S).toBeTruthy();
    const branch = ctx.services.logistics.findPath('rail', w.idx(2, 10), w.idx(15, 15));
    expect(branch).not.toBeNull();
    // parallel tracks next to each other do not connect in the middle
    ctx.services.logistics.buildNetwork(player, 'rail', w.line(2, 11, 8, 11), 1);
    expect(state.network.railConn[w.idx(5, 11)]! & Dir.N).toBe(0);
  });

  it('plans a construction path around obstacles', () => {
    const w = createTestWorld();
    const { ctx, state } = w;
    w.place('t_wh', 10, 4);
    w.place('t_wh', 10, 6);
    const from = w.idx(5, 6);
    const to = w.idx(16, 6);
    const p = ctx.services.logistics.planNetworkPath('road', from, to);
    expect(p).not.toBeNull();
    if (!p) return;
    expect(p[0]).toBe(from);
    expect(p[p.length - 1]).toBe(to);
    for (let k = 1; k < p.length; k++) {
      const a = p[k - 1]!;
      const b = p[k]!;
      const d = Math.abs(a - b);
      expect(d === 1 || d === state.map.width).toBe(true);
      expect(state.map.building[b]).toBe(0);
    }
    // re-uses an existing road (cheaper)
    ctx.services.logistics.buildNetwork(state.playerCompanyId, 'road', w.line(5, 20, 16, 20), 1);
    const q = ctx.services.logistics.planNetworkPath('road', w.idx(5, 19), w.idx(16, 19))!;
    expect(q.some((t) => state.network.road[t])).toBe(true);
  });

  it('charges monthly infrastructure upkeep', () => {
    const w = createTestWorld();
    const { ctx, state, player } = w;
    ctx.services.logistics.buildNetwork(player, 'rail', w.line(2, 2, 30, 2), 1);
    const before = state.companies[player]!.cash;
    ctx.sim.advanceDays(30);
    expect(state.companies[player]!.cash).toBeLessThan(before);
    const ledger = state.companies[player]!.finances.current.ledger;
    expect(ledger.infraUpkeep ?? 0).toBeLessThan(0);
  });
});
