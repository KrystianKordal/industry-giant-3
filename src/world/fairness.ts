/**
 * Fairness pass (end of the 'cities' step): every map gets the essential
 * early-era deposits within reach (same landmass, ≤ FAIR_RADIUS tiles) of some
 * cities, and every city has some fertile farmland nearby.
 */
import type { DataRegistry } from '../data/registry';
import type { DepositDef } from '../data/defs';
import { createRng, hashSeed, rng, type Rng } from '../core/rng';
import { Terrain, TileFlag, type City, type GameState, type NewGameOptions } from '../core/types';
import { clamp } from '../core/util';
import { depositPaletteIndex, depositTerrainOk, growDepositCluster, sortedDeposits } from './mapgen';
import { isWaterTerrain, type Landmasses } from './mapinfo';
import { hash01 } from './noise';

/** Max distance (tiles) from a city centre for a deposit to count as "near". */
export const FAIR_RADIUS = 16;
const MIN_RING = 5;

/** Deposits whose product is available in the start era (or earlier). */
export function essentialDeposits(data: DataRegistry, eraIdx: number): DepositDef[] {
  return sortedDeposits(data).filter((d) => {
    const p = data.products[d.product];
    return !!p && data.eraIndex(p.era) <= eraIdx;
  });
}

function hasDepositNear(state: GameState, lm: Landmasses, city: City, palette: number, radius: number): boolean {
  const map = state.map;
  const W = map.width;
  const H = map.height;
  const home = lm.id[city.y * W + city.x]!;
  for (let y = Math.max(0, city.y - radius); y <= Math.min(H - 1, city.y + radius); y++)
    for (let x = Math.max(0, city.x - radius); x <= Math.min(W - 1, city.x + radius); x++) {
      const i = y * W + x;
      if (map.deposit[i] !== palette || map.depositAmount[i]! <= 0) continue;
      if (map.terrain[i] === Terrain.Urban || map.house[i]) continue;
      if (Math.hypot(x - city.x, y - city.y) > radius) continue;
      if (lm.id[i] === home || isWaterTerrain(map.terrain[i]!)) return true;
    }
  return false;
}

function ringTiles(state: GameState, lm: Landmasses, city: City, pred: (i: number) => boolean): number[] {
  const map = state.map;
  const W = map.width;
  const H = map.height;
  const home = lm.id[city.y * W + city.x]!;
  const out: number[] = [];
  const R = FAIR_RADIUS - 3;
  for (let y = Math.max(0, city.y - R); y <= Math.min(H - 1, city.y + R); y++)
    for (let x = Math.max(0, city.x - R); x <= Math.min(W - 1, city.x + R); x++) {
      const d = Math.hypot(x - city.x, y - city.y);
      if (d < Math.max(MIN_RING, city.radius + 2) || d > R) continue;
      const i = y * W + x;
      if (map.city[i] && map.house[i]) continue;
      if (map.terrain[i] === Terrain.Urban || state.network.road[i] || map.deposit[i]) continue;
      if (lm.id[i] !== home && !isWaterTerrain(map.terrain[i]!)) continue;
      if (pred(i)) out.push(i);
    }
  return out;
}

function placeNear(state: GameState, lm: Landmasses, def: DepositDef, palette: number, city: City, r: Rng): boolean {
  const map = state.map;
  const W = map.width;
  let cands = ringTiles(state, lm, city, (i) => depositTerrainOk(def, map.terrain[i]!));
  if (cands.length === 0) {
    // Force: turn a small patch of ordinary land into the preferred land terrain.
    const landTerrain = (def.terrain as readonly number[]).find((t) => !isWaterTerrain(t) && t !== Terrain.Urban && t !== Terrain.Farmland);
    if (landTerrain === undefined) return false;
    const land = ringTiles(state, lm, city, (i) => {
      const t = map.terrain[i]!;
      return !isWaterTerrain(t) && t !== Terrain.Farmland && !(map.flags[i]! & TileFlag.River) && !map.building[i];
    });
    if (land.length === 0) return false;
    const c = land[r.int(0, land.length - 1)]!;
    const cx = c % W;
    const cy = (c / W) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const i = (cy + dy) * W + (cx + dx);
        if (land.includes(i)) {
          map.terrain[i] = landTerrain;
          map.forest[i] = 0;
        }
      }
    cands = [c];
  }
  const start = cands[r.int(0, cands.length - 1)]!;
  return growDepositCluster(map, def, palette, start % W, (start / W) | 0, r.int(6, 12), r.range(0.45, 0.8), r) > 0;
}

export function ensureFairness(state: GameState, data: DataRegistry, options: NewGameOptions, lm: Landmasses): void {
  const map = state.map;
  const W = map.width;
  const H = map.height;
  const cities = Object.values(state.cities).sort((a, b) => a.id - b.id);
  if (cities.length === 0) return;
  const r = rng(createRng(hashSeed(options.seed, 'fairness')));
  const eraIdx = Math.max(0, data.eraIndex(state.time.eraId));
  const needed = cities.length >= 3 ? 2 : 1;

  for (const def of essentialDeposits(data, eraIdx)) {
    const palette = depositPaletteIndex(map, def.id);
    if (palette < 1) continue;
    let near = cities.filter((c) => hasDepositNear(state, lm, c, palette, FAIR_RADIUS)).length;
    if (near >= needed) continue;
    // Prefer cities without the deposit, in a seed-dependent order.
    const order = r.shuffle(cities.filter((c) => !hasDepositNear(state, lm, c, palette, FAIR_RADIUS)));
    for (const c of order) {
      if (near >= needed) break;
      if (placeNear(state, lm, def, palette, c, r)) near++;
    }
  }

  // Farmland: every city gets fertile grass nearby.
  for (const c of cities) {
    const R = 12;
    let good = 0;
    const grass: number[] = [];
    for (let y = Math.max(0, c.y - R); y <= Math.min(H - 1, c.y + R); y++)
      for (let x = Math.max(0, c.x - R); x <= Math.min(W - 1, c.x + R); x++) {
        const i = y * W + x;
        if (map.terrain[i] !== Terrain.Grass || Math.hypot(x - c.x, y - c.y) > R) continue;
        grass.push(i);
        if (map.fertility[i]! >= 110) good++;
      }
    if (good >= 25) continue;
    for (const i of grass) map.fertility[i] = Math.max(map.fertility[i]!, clamp(Math.round(110 + hash01(options.seed, i, 5) * 70), 0, 255));
    if (grass.length < 25) {
      // Barren surroundings (desert/tundra): turn some flat land into fertile grass.
      let converted = grass.length;
      for (let y = Math.max(0, c.y - R); y <= Math.min(H - 1, c.y + R) && converted < 30; y++)
        for (let x = Math.max(0, c.x - R); x <= Math.min(W - 1, c.x + R) && converted < 30; x++) {
          const i = y * W + x;
          const t = map.terrain[i]!;
          const d = Math.hypot(x - c.x, y - c.y);
          if (d < c.radius + 2 || d > R || map.deposit[i] || map.city[i]) continue;
          if (t !== Terrain.Desert && t !== Terrain.Snow && t !== Terrain.Beach) continue;
          map.terrain[i] = Terrain.Grass;
          map.fertility[i] = 120;
          converted++;
        }
    }
  }
}
