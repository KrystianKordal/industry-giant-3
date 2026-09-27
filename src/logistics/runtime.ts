/**
 * Per-context runtime caches of the logistics module (NOT saved):
 * path cache, A* buffers, per-tile vehicle occupancy, per-tick path budget.
 * Rebuilt lazily whenever ctx.state is replaced (new game / load).
 */
import type { GameContext } from '../core/context';
import type { GameState, TileIndex } from '../core/types';
import { AStar } from './astar';
import { PATH_BUDGET_PER_TICK } from './constants';

export interface LogisticsRuntime {
  state: GameState;
  width: number;
  height: number;
  /** key "mode|fromTile|buildingId" → tile path (null = unreachable). */
  pathCache: Map<string, TileIndex[] | null>;
  /** Network version the cache was built for. */
  cacheVersion: number;
  /** Vehicles (non-air) currently on each tile, recomputed every tick. */
  occ: Uint16Array;
  /** Tiles with occ > 0 (for cheap clearing). */
  occTiles: number[];
  /** Remaining path searches this tick. */
  pathBudget: number;
  /** Search engine for vehicle paths (nodes = tiles). */
  finder: AStar;
  /** Search engine for construction planning (nodes = tile*5 + dir). */
  planner: AStar | null;
  /** Route utilisation: EMA of load fraction on departure, by route id. */
  routeLoad: Map<number, number>;
}

const runtimes = new WeakMap<GameContext, LogisticsRuntime>();

/** Get (or lazily create/reset) the runtime for the current state. */
export function rt(ctx: GameContext): LogisticsRuntime {
  const state = ctx.state;
  let r = runtimes.get(ctx);
  if (r && r.state === state) return r;
  const n = state.map.width * state.map.height;
  r = {
    state,
    width: state.map.width,
    height: state.map.height,
    pathCache: new Map(),
    cacheVersion: state.network.version,
    occ: new Uint16Array(n),
    occTiles: [],
    pathBudget: PATH_BUDGET_PER_TICK,
    finder: r && r.finder.capacity >= n ? r.finder : new AStar(n),
    planner: r?.planner ?? null,
    routeLoad: new Map(),
  };
  runtimes.set(ctx, r);
  return r;
}

/** Runtime if a game is running, else null (safe for UI/render). */
export function tryRt(ctx: GameContext): LogisticsRuntime | null {
  return ctx.hasGame ? rt(ctx) : null;
}

/** Drop cached paths (network or buildings changed). */
export function invalidatePaths(ctx: GameContext): void {
  const st = ctx.tryState();
  if (!st) return;
  const r = rt(ctx);
  r.pathCache.clear();
  r.cacheVersion = st.network.version;
}

export function dropRuntime(ctx: GameContext): void {
  runtimes.delete(ctx);
}
