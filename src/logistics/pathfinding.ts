/**
 * Vehicle pathfinding over the transport network (A* on tiles):
 *  - road:  road tiles, all 4-adjacent roads connect; cost = 1 / speed multiplier of road level
 *  - rail:  rail tiles following railConn bits
 *  - water: water / river tiles, 8-directional without corner cutting
 *  - air:   straight line (no search)
 * Results are cached per (mode, from tile, target) and dropped on network / building changes.
 * A per-tick budget caps the number of searches (vehicles retry next tick).
 */
import type { GameContext } from '../core/context';
import { TileFlag, type Building, type GameState, type TileIndex, type TransportMode } from '../core/types';
import type { DataRegistry } from '../data/registry';
import { accessTiles, isWaterTile } from './access';
import { MAX_SEARCH_NODES, RAIL_SPEED_MULT, ROAD_SPEED_MULT } from './constants';
import { DIR_BITS } from './network';
import { rt } from './runtime';

const SQRT2 = Math.SQRT2;
// 8 directions: N, E, S, W, NE, SE, SW, NW
const DX8 = [0, 1, 0, -1, 1, 1, -1, -1];
const DY8 = [-1, 0, 1, 0, -1, 1, 1, -1];

/** Can a vehicle of `mode` be on tile i? */
export function passable(state: GameState, data: DataRegistry, mode: TransportMode, i: TileIndex): boolean {
  switch (mode) {
    case 'road':
      return state.network.road[i]! > 0 && (state.map.flags[i]! & TileFlag.Damaged) === 0;
    case 'rail':
      return state.network.rail[i]! > 0 && (state.map.flags[i]! & TileFlag.Damaged) === 0;
    case 'water':
      return isWaterTile(state, data, i);
    case 'air':
      return true;
  }
}

/** Is the step a→b (4- or 8-adjacent) allowed for this mode right now? */
export function canStep(state: GameState, data: DataRegistry, mode: TransportMode, a: TileIndex, b: TileIndex): boolean {
  if (mode === 'air') return true;
  if (!passable(state, data, mode, b)) return false;
  if (mode === 'rail') {
    const W = state.map.width;
    const d: number = b - a === -W ? 0 : b - a === 1 ? 1 : b - a === W ? 2 : b - a === -1 ? 3 : -1;
    if (d < 0) return false;
    // allow leaving a tile without rail (e.g. start) but require the connection otherwise
    return !state.network.rail[a] || (state.network.railConn[a]! & DIR_BITS[d]!) !== 0;
  }
  return true;
}

function stepCost(state: GameState, mode: TransportMode, j: TileIndex): number {
  if (mode === 'road') return 1 / (ROAD_SPEED_MULT[state.network.road[j]!] ?? 1);
  if (mode === 'rail') return 1 / (RAIL_SPEED_MULT[state.network.rail[j]!] ?? 1);
  return 1;
}

const MIN_COST: Record<TransportMode, number> = { road: 1 / 1.35, rail: 1 / 1.7, water: 1, air: 1 };

/**
 * Raw A* from `sources` to any of `goals` for a mode. No caching / budget.
 * Returns tile path including source and goal.
 */
export function searchNetwork(ctx: GameContext, mode: TransportMode, sources: readonly TileIndex[], goals: readonly TileIndex[]): TileIndex[] | null {
  if (!sources.length || !goals.length) return null;
  const state = ctx.state;
  const data = ctx.data;
  const { width: W, height: H } = state.map;
  if (mode === 'air') return [sources[0]!, goals[0]!];
  const goalSet = goals.length > 8 ? new Set(goals) : null;
  let gx0 = W;
  let gy0 = H;
  let gx1 = 0;
  let gy1 = 0;
  for (const g of goals) {
    const x = g % W;
    const y = (g - x) / W;
    if (x < gx0) gx0 = x;
    if (y < gy0) gy0 = y;
    if (x > gx1) gx1 = x;
    if (y > gy1) gy1 = y;
  }
  const minC = MIN_COST[mode];
  const net = state.network;
  const flags = state.map.flags;
  const r = rt(ctx);
  return r.finder.search({
    sources,
    isGoal: goalSet ? (n) => goalSet.has(n) : (n) => goals.includes(n),
    heuristic: (n) => {
      const x = n % W;
      const y = (n - x) / W;
      const dx = x < gx0 ? gx0 - x : x > gx1 ? x - gx1 : 0;
      const dy = y < gy0 ? gy0 - y : y > gy1 ? y - gy1 : 0;
      if (mode === 'water') return (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy)) * minC;
      return (dx + dy) * minC;
    },
    neighbors: (n, push) => {
      const x = n % W;
      const y = (n - x) / W;
      if (mode === 'water') {
        for (let d = 0; d < 8; d++) {
          const nx = x + DX8[d]!;
          const ny = y + DY8[d]!;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (!isWaterTile(state, data, j)) continue;
          if (d >= 4) {
            // no corner cutting across land
            if (!isWaterTile(state, data, y * W + nx) || !isWaterTile(state, data, ny * W + x)) continue;
            push(j, SQRT2);
          } else push(j, 1);
        }
        return;
      }
      if (mode === 'rail') {
        const conn = net.rail[n] ? net.railConn[n]! : 0xf;
        for (let d = 0; d < 4; d++) {
          if (!(conn & DIR_BITS[d]!)) continue;
          const nx = x + DX8[d]!;
          const ny = y + DY8[d]!;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (!net.rail[j] || flags[j]! & TileFlag.Damaged) continue;
          push(j, stepCost(state, mode, j));
        }
        return;
      }
      // road: every adjacent road connects
      for (let d = 0; d < 4; d++) {
        const nx = x + DX8[d]!;
        const ny = y + DY8[d]!;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!net.road[j] || flags[j]! & TileFlag.Damaged) continue;
        push(j, stepCost(state, mode, j));
      }
    },
    maxNodes: MAX_SEARCH_NODES,
  });
}

function cacheCheck(ctx: GameContext): Map<string, TileIndex[] | null> {
  const r = rt(ctx);
  if (r.cacheVersion !== ctx.state.network.version || r.pathCache.size > 20000) {
    r.pathCache.clear();
    r.cacheVersion = ctx.state.network.version;
  }
  return r.pathCache;
}

/** Tile → tile path over the network (cached). */
export function findTilePath(ctx: GameContext, mode: TransportMode, from: TileIndex, to: TileIndex): TileIndex[] | null {
  const cache = cacheCheck(ctx);
  const key = `${mode}|${from}|t${to}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const p = from === to ? [from] : searchNetwork(ctx, mode, [from], [to]);
  cache.set(key, p);
  return p;
}

/**
 * Path from tile `from` to any access tile of building b (cached).
 * Returns undefined when the per-tick budget is exhausted (retry later) and
 * null when unreachable.
 */
export function findPathToBuilding(ctx: GameContext, mode: TransportMode, from: TileIndex, b: Building, useBudget = false): TileIndex[] | null | undefined {
  // The per-tick budget is charged BEFORE the cache lookup: whether a vehicle gets to plan
  // this tick must not depend on the (runtime-only) cache, or a loaded save would diverge.
  if (useBudget) {
    const r = rt(ctx);
    if (r.pathBudget <= 0) return undefined;
    r.pathBudget--;
  }
  const cache = cacheCheck(ctx);
  const key = `${mode}|${from}|${b.id}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const goals = accessTiles(ctx, b, mode);
  let p: TileIndex[] | null;
  if (!goals.length) p = null;
  else if (goals.includes(from)) p = [from];
  else p = searchNetwork(ctx, mode, [from], goals);
  cache.set(key, p);
  return p;
}

/** Path between two buildings (from any access tile of a to any of b). Cached. */
export function findBuildingPath(ctx: GameContext, mode: TransportMode, a: Building, b: Building): TileIndex[] | null {
  const cache = cacheCheck(ctx);
  const key = `${mode}|b${a.id}|${b.id}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const src = accessTiles(ctx, a, mode);
  const dst = accessTiles(ctx, b, mode);
  let p: TileIndex[] | null = null;
  if (src.length && dst.length) {
    const common = src.find((t) => dst.includes(t));
    p = common !== undefined ? [common] : searchNetwork(ctx, mode, src, dst);
  }
  cache.set(key, p);
  return p;
}

/** Euclidean length of a path in tiles. */
export function pathLength(W: number, path: readonly TileIndex[]): number {
  let len = 0;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1]!;
    const b = path[k]!;
    const ax = a % W;
    const bx = b % W;
    len += Math.hypot(bx - ax, (b - bx) / W - (a - ax) / W);
  }
  return len;
}
