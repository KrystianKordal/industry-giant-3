/**
 * World service implementation (ctx.services.world) + direct helper exports.
 * All functions operate on the current ctx.state.
 */
import type { GameContext } from '../core/context';
import type { WorldService } from '../core/services';
import { Terrain, TileFlag, type CityId, type GameState, type TileIndex } from '../core/types';
import { inBounds } from '../core/util';
import { eventModifier } from './effects';
import { isWaterTerrain } from './mapinfo';
import { weatherAt, weatherModifier } from './weather';

/** Nearest city centre within maxDist (0 = none). Ties → lower id. */
export function nearestCity(state: GameState, x: number, y: number, maxDist = Infinity): CityId {
  let best = 0;
  let bd = maxDist;
  for (const c of Object.values(state.cities)) {
    const d = Math.hypot(x - c.x, y - c.y);
    if (d < bd || (d === bd && best !== 0 && c.id < best)) {
      bd = d;
      best = c.id;
    }
  }
  return best;
}

export function tilesInRadius(state: GameState, x: number, y: number, r: number): TileIndex[] {
  const m = state.map;
  const out: TileIndex[] = [];
  const rr = Math.max(0, r);
  for (let ty = Math.max(0, Math.floor(y - rr)); ty <= Math.min(m.height - 1, Math.ceil(y + rr)); ty++)
    for (let tx = Math.max(0, Math.floor(x - rr)); tx <= Math.min(m.width - 1, Math.ceil(x + rr)); tx++)
      if (Math.hypot(tx - x, ty - y) <= rr) out.push(ty * m.width + tx);
  return out;
}

/** Can a building stand on this tile (terrain buildable, free, no road/rail/house, not blocked)? */
export function isBuildableTile(ctx: GameContext, x: number, y: number): boolean {
  const state = ctx.state;
  const m = state.map;
  if (!inBounds(m, x, y)) return false;
  const i = y * m.width + x;
  if (!ctx.data.terrain[m.terrain[i]!]?.buildable) return false;
  if (m.building[i] || m.house[i] || state.network.road[i] || state.network.rail[i]) return false;
  return !(m.flags[i]! & TileFlag.Blocked);
}

/**
 * Road/rail cost multiplier for a tile: TerrainDef.networkCost × slope factor,
 * river crossing (bridge) ×3 road / ×4 rail, rail through town ×2. Water = Infinity
 * (bridging open water is logistics' decision).
 */
export function terrainCost(ctx: GameContext, x: number, y: number, kind: 'road' | 'rail'): number {
  const m = ctx.state.map;
  if (!inBounds(m, x, y)) return Infinity;
  const W = m.width;
  const i = y * W + x;
  const t = m.terrain[i]!;
  if (isWaterTerrain(t)) return Infinity;
  let c = ctx.data.terrain[t]?.networkCost ?? 1;
  if (!Number.isFinite(c)) return Infinity;
  const e = m.elevation[i]!;
  let slope = 0;
  if (x > 0 && !isWaterTerrain(m.terrain[i - 1]!)) slope = Math.max(slope, Math.abs(e - m.elevation[i - 1]!));
  if (x < W - 1 && !isWaterTerrain(m.terrain[i + 1]!)) slope = Math.max(slope, Math.abs(e - m.elevation[i + 1]!));
  if (y > 0 && !isWaterTerrain(m.terrain[i - W]!)) slope = Math.max(slope, Math.abs(e - m.elevation[i - W]!));
  if (y < m.height - 1 && !isWaterTerrain(m.terrain[i + W]!)) slope = Math.max(slope, Math.abs(e - m.elevation[i + W]!));
  c *= 1 + slope / (kind === 'rail' ? 15 : 25);
  if (m.flags[i]! & TileFlag.River && !(m.flags[i]! & TileFlag.Bridge)) c *= kind === 'rail' ? 4 : 3;
  if (kind === 'rail' && (t === Terrain.Urban || m.house[i])) c *= 2;
  return Math.round(c * 100) / 100;
}

/** Weather × event multiplier at a tile (x/y undefined → global events only). */
export function modifierAt(state: GameState, key: string, x?: number, y?: number): number {
  if (x === undefined || y === undefined) return eventModifier(state, key, null);
  const w = weatherModifier(state, key, weatherAt(state, x, y));
  return w * eventModifier(state, key, { x, y }, state.map.city[y * state.map.width + x] ?? 0);
}

/** Is water transport blocked at the tile (storm event)? */
export const isWaterBlocked = (state: GameState, x: number, y: number): boolean => modifierAt(state, 'speed.water', x, y) <= 0;

export function createWorldService(ctx: GameContext): Partial<WorldService> {
  return {
    cityAt(x, y) {
      const m = ctx.state.map;
      return inBounds(m, x, y) ? m.city[y * m.width + x]! : 0;
    },
    nearestCity: (x, y, maxDist) => nearestCity(ctx.state, x, y, maxDist),
    regionAt(x, y) {
      const w = ctx.state.weather;
      const cx = Math.min(w.cols - 1, Math.max(0, Math.floor(x / w.regionSize)));
      const cy = Math.min(w.rows - 1, Math.max(0, Math.floor(y / w.regionSize)));
      return cy * w.cols + cx;
    },
    isBuildableTile: (x, y) => isBuildableTile(ctx, x, y),
    tilesInRadius: (x, y, r) => tilesInRadius(ctx.state, x, y, r),
    terrainCost: (x, y, kind) => terrainCost(ctx, x, y, kind),
    weatherAt: (x, y) => weatherAt(ctx.state, x, y),
    modifierAt: (key, x, y) => modifierAt(ctx.state, key, x, y),
  };
}
