/**
 * Road / rail network: construction rules & costs, bridges, bulldozing,
 * connection masks and construction path planning (A* over terrain).
 *
 * Connectivity:
 *  - roads auto-connect to every 4-adjacent road tile (roadConn = N|E|S|W bits);
 *  - rails connect consecutive tiles of the built path; path endpoints (and single
 *    tiles) also connect to adjacent rail tiles. So crossing tracks do NOT form a
 *    junction unless drawn through. railConn uses only N/E/S/W bits for now.
 *  - tiles over water / rivers become bridges (TileFlag.Bridge), must be straight,
 *    max MAX_BRIDGE_SPAN long and cost BRIDGE_MULT×.
 */
import type { ActionResult } from '../core/services';
import type { GameContext } from '../core/context';
import { addMoney } from '../core/money';
import { Dir, TileFlag, type CompanyId, type GameState, type TileIndex } from '../core/types';
import { DIR4 } from '../core/util';
import type { DataRegistry } from '../data/registry';
import { AStar } from './astar';
import { isWaterTile } from './access';
import {
  BRIDGE_MULT,
  BRIDGE_UPKEEP_MULT,
  FOREST_CLEAR_MULT,
  MAX_BRIDGE_SPAN,
  PLAN_MARGIN,
  RAIL_COST,
  RAIL_LEVEL_ERA,
  RAIL_LEVEL_NAMES,
  RAIL_UPKEEP,
  REFUND_RATE,
  ROAD_COST,
  ROAD_LEVEL_ERA,
  ROAD_LEVEL_NAMES,
  ROAD_UPKEEP,
} from './constants';
import { invalidatePaths, rt } from './runtime';

export type NetKind = 'road' | 'rail';

/** Direction bits in DIR4 order (N, E, S, W). */
export const DIR_BITS = [Dir.N, Dir.E, Dir.S, Dir.W] as const;
export const OPPOSITE = [2, 3, 0, 1] as const;

export const maxLevel = (kind: NetKind): number => (kind === 'road' ? ROAD_COST.length - 1 : RAIL_COST.length - 1);
export const levelName = (kind: NetKind, level: number): string =>
  (kind === 'road' ? ROAD_LEVEL_NAMES[level] : RAIL_LEVEL_NAMES[level]) ?? '';

/** Is this network level available in the current era? */
export function levelUnlocked(ctx: GameContext, kind: NetKind, level: number): boolean {
  const req = (kind === 'road' ? ROAD_LEVEL_ERA : RAIL_LEVEL_ERA)[level];
  if (req === undefined) return false;
  return ctx.data.eraIndex(ctx.state.time.eraId) >= req;
}

/** Highest unlocked level of a kind. */
export function bestLevel(ctx: GameContext, kind: NetKind): number {
  let l = 1;
  for (let i = 1; i <= maxLevel(kind); i++) if (levelUnlocked(ctx, kind, i)) l = i;
  return l;
}

/** Direction index 0..3 from tile a to 4-adjacent tile b (-1 if not adjacent). */
export function dirBetween(W: number, a: TileIndex, b: TileIndex): number {
  const d = b - a;
  if (d === -W) return 0;
  if (d === W) return 2;
  if (d === 1 && b % W !== 0) return 1;
  if (d === -1 && a % W !== 0) return 3;
  return -1;
}

/** Does tile need a bridge (water or river)? */
export const needsBridge = (state: GameState, data: DataRegistry, i: TileIndex): boolean => isWaterTile(state, data, i);

export interface TileCheck {
  ok: boolean;
  reason?: string;
  /** Cost to build/upgrade this tile (0 if already present at >= level). */
  cost: number;
  bridge: boolean;
  /** Tile already has this kind at >= level (only connecting). */
  existing: boolean;
}

/** Base price of one tile (before existing-network discount). */
export function tileBaseCost(state: GameState, data: DataRegistry, kind: NetKind, level: number, i: TileIndex): number {
  const table = kind === 'road' ? ROAD_COST : RAIL_COST;
  const base = table[level] ?? table[1];
  const t = data.terrain[state.map.terrain[i]!];
  if (needsBridge(state, data, i)) return base * BRIDGE_MULT[kind];
  let mult = t && Number.isFinite(t.networkCost) ? t.networkCost : 1;
  if (state.map.forest[i]! > 0) mult *= FOREST_CLEAR_MULT;
  return base * mult;
}

/** Validate one tile for construction of `kind` at `level`. */
export function checkTile(ctx: GameContext, companyId: CompanyId, kind: NetKind, level: number, i: TileIndex): TileCheck {
  const state = ctx.state;
  const map = state.map;
  const n = map.width * map.height;
  if (!(i >= 0 && i < n)) return { ok: false, reason: 'Poza mapą', cost: 0, bridge: false, existing: false };
  const net = state.network;
  const cur = kind === 'road' ? net.road[i]! : net.rail[i]!;
  const bridge = needsBridge(state, ctx.data, i);
  if (cur >= level) return { ok: true, cost: 0, bridge, existing: true };
  if (map.flags[i]! & TileFlag.Blocked) return { ok: false, reason: 'Teren zablokowany', cost: 0, bridge, existing: false };
  if (map.building[i]) return { ok: false, reason: 'Na drodze stoi budynek', cost: 0, bridge, existing: false };
  if (map.house[i]! > 0 && !net.road[i]) return { ok: false, reason: 'Zabudowa miejska', cost: 0, bridge, existing: false };
  if (cur > 0 && net.owner[i] && net.owner[i] !== companyId)
    return { ok: false, reason: 'Infrastruktura innej firmy', cost: 0, bridge, existing: false };
  const t = ctx.data.terrain[map.terrain[i]!];
  if (!bridge && t && !Number.isFinite(t.networkCost)) return { ok: false, reason: `Nie można budować na: ${t.name}`, cost: 0, bridge, existing: false };
  let cost = tileBaseCost(state, ctx.data, kind, level, i);
  if (cur > 0) cost -= tileBaseCost(state, ctx.data, kind, cur, i); // upgrade: pay the difference
  return { ok: true, cost: Math.max(0, Math.round(cost)), bridge, existing: false };
}

export interface NetworkEstimate {
  ok: boolean;
  reason?: string;
  cost: number;
  /** Per-tile results (same order as input, duplicates removed). */
  tiles: TileIndex[];
  checks: TileCheck[];
  bridgeTiles: number;
  newTiles: number;
}

/** Validate a whole path (bridge straightness/span, level unlock, cash). */
export function estimatePath(ctx: GameContext, companyId: CompanyId, kind: NetKind, input: readonly TileIndex[], level?: number): NetworkEstimate {
  const lvl = level ?? bestLevel(ctx, kind);
  const tiles = dedupe(input);
  const res: NetworkEstimate = { ok: true, cost: 0, tiles, checks: [], bridgeTiles: 0, newTiles: 0 };
  const fail = (reason: string): NetworkEstimate => {
    res.ok = false;
    res.reason ??= reason;
    return res;
  };
  if (!tiles.length) return fail('Brak kafli');
  if (lvl < 1 || lvl > maxLevel(kind)) return fail('Nieznany poziom');
  if (!levelUnlocked(ctx, kind, lvl)) return fail(`${levelName(kind, lvl)}: niedostępne w tej epoce`);
  const W = ctx.state.map.width;
  let span = 0;
  for (let k = 0; k < tiles.length; k++) {
    const i = tiles[k]!;
    const c = checkTile(ctx, companyId, kind, lvl, i);
    res.checks.push(c);
    if (!c.ok) fail(c.reason ?? 'Nie można budować');
    res.cost += c.cost;
    if (!c.existing) res.newTiles++;
    if (c.bridge) {
      res.bridgeTiles++;
      span++;
      if (span > MAX_BRIDGE_SPAN) fail(`Most zbyt długi (max ${MAX_BRIDGE_SPAN} pól)`);
      const prev = tiles[k - 1];
      const next = tiles[k + 1];
      if (prev === undefined || next === undefined) {
        if (tiles.length > 1) fail('Most musi zaczynać i kończyć się na lądzie');
      } else {
        const d1 = dirBetween(W, prev, i);
        const d2 = dirBetween(W, i, next);
        if (d1 >= 0 && d2 >= 0 && d1 !== d2) fail('Most musi być prosty');
      }
    } else span = 0;
  }
  const company = ctx.state.companies[companyId];
  if (res.ok && company && company.cash < res.cost) fail('Brak środków');
  return res;
}

function dedupe(tiles: readonly TileIndex[]): TileIndex[] {
  const out: TileIndex[] = [];
  const seen = new Set<number>();
  for (const t of tiles) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

// ============================================================================
// Connection masks
// ============================================================================

/** Recompute road connection bits for tile i (all adjacent roads connect). */
export function updateRoadConn(state: GameState, i: TileIndex): void {
  const { width: W, height: H } = state.map;
  const net = state.network;
  if (!net.road[i]) {
    net.roadConn[i] = 0;
    return;
  }
  const x = i % W;
  const y = (i - x) / W;
  let m = 0;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR4[d]![0];
    const ny = y + DIR4[d]![1];
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    if (net.road[ny * W + nx]) m |= DIR_BITS[d]!;
  }
  net.roadConn[i] = m;
}

/** Recompute road masks for all tiles (used on load / foreign changes). */
export function rebuildRoadConn(state: GameState): void {
  const n = state.map.width * state.map.height;
  for (let i = 0; i < n; i++) if (state.network.road[i] || state.network.roadConn[i]) updateRoadConn(state, i);
}

function connectRail(state: GameState, a: TileIndex, b: TileIndex): void {
  const d = dirBetween(state.map.width, a, b);
  if (d < 0) return;
  const net = state.network;
  net.railConn[a]! |= DIR_BITS[d]!;
  net.railConn[b]! |= DIR_BITS[OPPOSITE[d]!]!;
}

/** Neighbour tile in direction d (or -1). */
export function neighbor(W: number, H: number, i: TileIndex, d: number): number {
  const x = i % W;
  const y = (i - x) / W;
  const nx = x + DIR4[d]![0];
  const ny = y + DIR4[d]![1];
  return nx < 0 || ny < 0 || nx >= W || ny >= H ? -1 : ny * W + nx;
}

// ============================================================================
// Build / remove
// ============================================================================

export function buildNetwork(ctx: GameContext, companyId: CompanyId, kind: NetKind, input: readonly TileIndex[], level?: number): ActionResult<{ tiles: number; bridges: number }> {
  const est = estimatePath(ctx, companyId, kind, input, level);
  if (!est.ok) return { ok: false, reason: est.reason ?? 'Nie można budować' };
  const lvl = level ?? bestLevel(ctx, kind);
  const state = ctx.state;
  const { width: W, height: H } = state.map;
  const net = state.network;
  const arr = kind === 'road' ? net.road : net.rail;
  const changed: TileIndex[] = [];
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  est.tiles.forEach((i, k) => {
    const c = est.checks[k]!;
    if (!c.existing) {
      if (!arr[i]) net.owner[i] = companyId;
      arr[i] = lvl;
      if (c.bridge) state.map.flags[i]! |= TileFlag.Bridge;
      state.map.forest[i] = 0;
      changed.push(i);
    }
    const x = i % W;
    const y = (i - x) / W;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  });
  // connections
  if (kind === 'road') {
    for (const i of est.tiles) {
      updateRoadConn(state, i);
      for (let d = 0; d < 4; d++) {
        const j = neighbor(W, H, i, d);
        if (j >= 0) updateRoadConn(state, j);
      }
    }
  } else {
    const tiles = est.tiles;
    for (let k = 0; k + 1 < tiles.length; k++) connectRail(state, tiles[k]!, tiles[k + 1]!);
    // segment endpoints connect to any adjacent rail
    for (let k = 0; k < tiles.length; k++) {
      const i = tiles[k]!;
      const prevAdj = k > 0 && dirBetween(W, tiles[k - 1]!, i) >= 0;
      const nextAdj = k + 1 < tiles.length && dirBetween(W, i, tiles[k + 1]!) >= 0;
      if (prevAdj && nextAdj) continue;
      for (let d = 0; d < 4; d++) {
        const j = neighbor(W, H, i, d);
        if (j >= 0 && net.rail[j]) connectRail(state, i, j);
      }
    }
  }
  if (est.cost > 0) addMoney(ctx, companyId, -est.cost, 'construction');
  net.version++;
  invalidatePaths(ctx);
  const touched = changed.length ? changed : est.tiles;
  ctx.bus.emit('network:changed', { kind, tiles: touched });
  if (x1 >= 0) ctx.bus.emit('map:changed', { x: x0 - 1, y: y0 - 1, w: x1 - x0 + 3, h: y1 - y0 + 3 });
  if (changed.length) ctx.bus.emit('sfx', { id: kind, x: tiles0x(W, est.tiles[0]!), y: Math.floor(est.tiles[0]! / W) });
  return { ok: true, cost: est.cost, tiles: changed.length, bridges: est.bridgeTiles };
}

const tiles0x = (W: number, i: number): number => i % W;

/** Refund for removing one tile of kind at its current level. */
export function refundFor(ctx: GameContext, kind: NetKind, i: TileIndex): number {
  const state = ctx.state;
  const lvl = kind === 'road' ? state.network.road[i]! : state.network.rail[i]!;
  if (!lvl) return 0;
  return Math.round(tileBaseCost(state, ctx.data, kind, lvl, i) * REFUND_RATE);
}

/** Can company remove this tile? */
export function canRemove(ctx: GameContext, companyId: CompanyId, kind: NetKind, i: TileIndex): { ok: boolean; reason?: string } {
  const net = ctx.state.network;
  const n = net.road.length;
  if (!(i >= 0 && i < n)) return { ok: false, reason: 'Poza mapą' };
  const lvl = kind === 'road' ? net.road[i]! : net.rail[i]!;
  if (!lvl) return { ok: false, reason: kind === 'road' ? 'Brak drogi' : 'Brak torów' };
  const owner = net.owner[i]!;
  if (owner === 0) return { ok: false, reason: 'Infrastruktura publiczna' };
  if (owner !== companyId) return { ok: false, reason: 'Infrastruktura innej firmy' };
  return { ok: true };
}

export function removeNetwork(ctx: GameContext, companyId: CompanyId, kind: NetKind, input: readonly TileIndex[]): ActionResult<{ tiles: number }> {
  const state = ctx.state;
  const { width: W, height: H } = state.map;
  const net = state.network;
  const tiles = dedupe(input).filter((i) => canRemove(ctx, companyId, kind, i).ok);
  if (!tiles.length) {
    const first = input[0];
    return { ok: false, reason: first !== undefined ? (canRemove(ctx, companyId, kind, first).reason ?? 'Nic do usunięcia') : 'Nic do usunięcia' };
  }
  let refund = 0;
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (const i of tiles) {
    refund += refundFor(ctx, kind, i);
    if (kind === 'road') {
      net.road[i] = 0;
      net.roadConn[i] = 0;
    } else {
      net.rail[i] = 0;
      for (let d = 0; d < 4; d++) {
        const j = neighbor(W, H, i, d);
        if (j >= 0) net.railConn[j]! &= ~DIR_BITS[OPPOSITE[d]!]!;
      }
      net.railConn[i] = 0;
    }
    if (!net.road[i] && !net.rail[i]) {
      net.owner[i] = 0;
      net.traffic[i] = 0;
      state.map.flags[i]! &= ~TileFlag.Bridge;
    }
    const x = i % W;
    const y = (i - x) / W;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  if (kind === 'road')
    for (const i of tiles)
      for (let d = 0; d < 4; d++) {
        const j = neighbor(W, H, i, d);
        if (j >= 0) updateRoadConn(state, j);
      }
  if (refund > 0) addMoney(ctx, companyId, refund, 'assetSale');
  net.version++;
  invalidatePaths(ctx);
  ctx.bus.emit('network:changed', { kind, tiles });
  ctx.bus.emit('map:changed', { x: x0 - 1, y: y0 - 1, w: x1 - x0 + 3, h: y1 - y0 + 3 });
  ctx.bus.emit('sfx', { id: 'demolish', x: x0, y: y0 });
  return { ok: true, cost: -refund, tiles: tiles.length };
}

// ============================================================================
// Monthly infrastructure upkeep
// ============================================================================

export function chargeInfraUpkeep(ctx: GameContext): void {
  const state = ctx.state;
  const net = state.network;
  const n = net.road.length;
  const perOwner = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const r = net.road[i]!;
    const l = net.rail[i]!;
    if (!r && !l) continue;
    const owner = net.owner[i]!;
    if (!owner) continue;
    let c = ROAD_UPKEEP[r] ?? 0;
    c += RAIL_UPKEEP[l] ?? 0;
    if (state.map.flags[i]! & TileFlag.Bridge) c *= BRIDGE_UPKEEP_MULT;
    perOwner.set(owner, (perOwner.get(owner) ?? 0) + c);
  }
  for (const [owner, cost] of perOwner) {
    const c = state.companies[owner];
    if (!c || c.bankrupt) continue;
    const mul = c.modifiers['upkeep.infra'] ?? c.modifiers['upkeep.all'] ?? 1;
    const amount = Math.round(cost * mul);
    if (amount > 0) addMoney(ctx, owner, -amount, 'infraUpkeep');
  }
}

// ============================================================================
// Construction path planning (A* over terrain, nodes = tile*5 + arrivalDir)
// ============================================================================

function planner(ctx: GameContext): AStar {
  const r = rt(ctx);
  const need = r.width * r.height * 5;
  if (!r.planner) r.planner = new AStar(need);
  else r.planner.ensure(need);
  return r.planner;
}

/** Plan tiles for a new road/rail from any source tile to any goal tile. */
export function planBetween(ctx: GameContext, kind: NetKind, sources: readonly TileIndex[], goals: readonly TileIndex[], companyId?: CompanyId): TileIndex[] | null {
  if (!sources.length || !goals.length) return null;
  const state = ctx.state;
  const data = ctx.data;
  const { width: W, height: H } = state.map;
  const net = state.network;
  const arr = kind === 'road' ? net.road : net.rail;
  const owner = companyId ?? state.playerCompanyId;
  const goalSet = new Set(goals);
  // search box
  let bx0 = W;
  let by0 = H;
  let bx1 = 0;
  let by1 = 0;
  let gx0 = W;
  let gy0 = H;
  let gx1 = 0;
  let gy1 = 0;
  for (const t of sources) {
    const x = t % W;
    const y = (t - x) / W;
    bx0 = Math.min(bx0, x);
    by0 = Math.min(by0, y);
    bx1 = Math.max(bx1, x);
    by1 = Math.max(by1, y);
  }
  for (const t of goals) {
    const x = t % W;
    const y = (t - x) / W;
    gx0 = Math.min(gx0, x);
    gy0 = Math.min(gy0, y);
    gx1 = Math.max(gx1, x);
    gy1 = Math.max(gy1, y);
  }
  bx0 = Math.max(0, Math.min(bx0, gx0) - PLAN_MARGIN);
  by0 = Math.max(0, Math.min(by0, gy0) - PLAN_MARGIN);
  bx1 = Math.min(W - 1, Math.max(bx1, gx1) + PLAN_MARGIN);
  by1 = Math.min(H - 1, Math.max(by1, gy1) + PLAN_MARGIN);

  // passability/cost per tile cached lazily for this search
  const tileCost = (i: number): number => {
    if (arr[i]) return 0.3; // reuse existing network
    const c = checkTile(ctx, owner, kind, 1, i);
    if (!c.ok) return -1;
    const base = kind === 'road' ? ROAD_COST[1] : RAIL_COST[1];
    return tileBaseCost(state, data, kind, 1, i) / base;
  };
  const costCache = new Map<number, number>();
  const cost = (i: number): number => {
    let c = costCache.get(i);
    if (c === undefined) {
      c = tileCost(i);
      costCache.set(i, c);
    }
    return c;
  };
  const bridgeAt = (i: number): boolean => !arr[i] && needsBridge(state, data, i);
  const hScale = 0.6;
  const search = planner(ctx);
  const nodes = search.search({
    sources: sources.filter((t) => cost(t) >= 0).map((t) => t * 5 + 4),
    isGoal: (node) => goalSet.has((node / 5) | 0),
    heuristic: (node) => {
      const t = (node / 5) | 0;
      const x = t % W;
      const y = (t - x) / W;
      const dx = x < gx0 ? gx0 - x : x > gx1 ? x - gx1 : 0;
      const dy = y < gy0 ? gy0 - y : y > gy1 ? y - gy1 : 0;
      return (dx + dy) * hScale;
    },
    neighbors: (node, push) => {
      const t = (node / 5) | 0;
      const inDir = node - t * 5;
      const onBridge = bridgeAt(t);
      const x = t % W;
      const y = (t - x) / W;
      for (let d = 0; d < 4; d++) {
        if (onBridge && inDir !== 4 && d !== inDir) continue; // bridges are straight
        const nx = x + DIR4[d]![0];
        const ny = y + DIR4[d]![1];
        if (nx < bx0 || ny < by0 || nx > bx1 || ny > by1) continue;
        const j = ny * W + nx;
        const c = cost(j);
        if (c < 0) continue;
        const turn = inDir !== 4 && inDir !== d ? 0.15 : 0;
        push(j * 5 + d, c + turn);
      }
    },
    maxNodes: 400_000,
  });
  if (!nodes) return null;
  const tiles: TileIndex[] = [];
  for (const n of nodes) {
    const t = (n / 5) | 0;
    if (tiles[tiles.length - 1] !== t) tiles.push(t);
  }
  return tiles;
}

/** Straight L-shaped path (horizontal first, or vertical first). */
export function lPath(W: number, from: TileIndex, to: TileIndex, verticalFirst = false): TileIndex[] {
  const fx = from % W;
  const fy = (from - fx) / W;
  const tx = to % W;
  const ty = (to - tx) / W;
  const out: TileIndex[] = [];
  let x = fx;
  let y = fy;
  out.push(y * W + x);
  const stepX = (): void => {
    while (x !== tx) {
      x += Math.sign(tx - x);
      out.push(y * W + x);
    }
  };
  const stepY = (): void => {
    while (y !== ty) {
      y += Math.sign(ty - y);
      out.push(y * W + x);
    }
  };
  if (verticalFirst) {
    stepY();
    stepX();
  } else {
    stepX();
    stepY();
  }
  return out;
}
