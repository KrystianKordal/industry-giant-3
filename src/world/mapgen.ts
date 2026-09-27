/**
 * Procedural map generation (new-game step 'mapgen').
 *
 * Pipeline (all seeded, deterministic for seed + options + deposit defs):
 *  1. elevation  — simplex fBm + ridged mountain ranges + preset mask
 *  2. sea level  — quantile of elevation = options.waterLevel (preset-adjusted)
 *  3. ocean/lakes — water connected to the border = ocean; priority-flood fills
 *                  depressions, deep ones become lakes
 *  4. rivers     — flow tree from the priority flood (every land tile drains to
 *                  sea / map edge), flow accumulation weighted by rain; the top
 *                  accumulation tiles get TileFlag.River
 *  5. climate    — warmth by latitude/altitude/climate zone, moisture by noise +
 *                  proximity to water/rivers
 *  6. terrain    — mountains, hills, snow, beach, desert, swamp, forest, grass
 *  7. soil       — fertility (moisture sweet spot, rivers, soil noise), forest density
 *  8. flags      — Coast
 *  9. deposits   — generic over data registry DepositDefs (amount + quality)
 *
 * Elevation encoding: water 0..(seaLevel-1), land seaLevel..255 (map.seaLevel = SEA_LEVEL).
 */
import type { DepositDef } from '../data/defs';
import type { DataRegistry } from '../data/registry';
import { createRng, hashSeed, rng, type Rng } from '../core/rng';
import { Terrain, TileFlag, type ClimateZone, type GameState, type MapState, type NewGameOptions } from '../core/types';
import { clamp } from '../core/util';
import { bfsDistance, computeOcean, isWaterTerrain } from './mapinfo';
import { createSimplex2D, fbm, hash01, ridged } from './noise';

/** map.seaLevel written by mapgen: elevation byte where land starts. */
export const SEA_LEVEL = 50;

/** Feature scale: noise units per tile (≈ 1 / typical feature size in tiles). */
const SCALE = 1 / 52;

const CLIMATE_WARMTH: Record<ClimateZone, number> = { temperate: 0.5, continental: 0.4, arid: 0.68, tropical: 0.8, arctic: 0.2 };
const CLIMATE_MOIST: Record<ClimateZone, number> = { temperate: 0, continental: -0.05, arid: -0.22, tropical: 0.12, arctic: -0.05 };

const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Pick the dominant map climate from the seed. */
export function pickClimate(seed: number): ClimateZone {
  const v = hash01(hashSeed(seed, 'climate'));
  return v < 0.5 ? 'temperate' : v < 0.75 ? 'continental' : v < 0.88 ? 'arid' : 'tropical';
}

/** Fraction of water tiles for a preset. */
function waterFraction(o: NewGameOptions): number {
  const wl = clamp(o.waterLevel, 0, 0.9);
  switch (o.mapPreset) {
    case 'islands':
      return Math.max(wl, 0.55);
    case 'archipelago':
      return Math.max(wl, 0.62);
    case 'inland':
      return Math.min(wl * 0.2, 0.08);
    default:
      return wl;
  }
}

// ============================================================================
// Main entry
// ============================================================================

export function generateMap(state: GameState, options: NewGameOptions, data: DataRegistry): void {
  const map = state.map;
  const W = map.width;
  const H = map.height;
  const N = W * H;
  const seed = options.seed >>> 0;
  const r = rng(createRng(hashSeed(seed, 'mapgen')));
  const preset = options.mapPreset;

  // Reset (steps may be re-run in tests).
  map.flags.fill(0);
  map.deposit.fill(0);
  map.depositAmount.fill(0);
  map.depositQuality.fill(0);
  map.forest.fill(0);
  map.fertility.fill(0);
  map.house.fill(0);
  map.city.fill(0);

  const climate = pickClimate(seed);
  map.climate = climate;
  map.seed = seed;

  // ------------------------------------------------------------ 1. elevation
  const nElev = createSimplex2D(hashSeed(seed, 'elev'));
  const nRidge = createSimplex2D(hashSeed(seed, 'ridge'));
  const nMask = createSimplex2D(hashSeed(seed, 'mmask'));
  const ox = r.range(0, 512);
  const oy = r.range(0, 512);
  const islandCenters: { x: number; y: number; r: number }[] = [];
  if (preset === 'islands') {
    const n = clamp(Math.round(Math.sqrt(N) / 40) + r.int(1, 3), 2, 8);
    for (let k = 0; k < n; k++) islandCenters.push({ x: r.range(0.18, 0.82), y: r.range(0.18, 0.82), r: r.range(0.14, 0.3) });
  }
  const coastSide = r.int(0, 3);
  const elevScale = preset === 'archipelago' ? SCALE * 1.8 : SCALE;
  const e = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    const ny = (y / (H - 1)) * 2 - 1;
    for (let x = 0; x < W; x++) {
      const nx = (x / (W - 1)) * 2 - 1;
      let v = fbm(nElev, x * elevScale + ox, y * elevScale + oy, 5) * 0.5 + 0.5;
      const mm = smoothstep(0.05, 0.45, nMask(x * SCALE * 0.55 + oy, y * SCALE * 0.55 + ox));
      if (mm > 0) v += ridged(nRidge, x * SCALE * 1.7 + ox, y * SCALE * 1.7 + oy, 4) * 0.38 * mm;
      const box = Math.max(Math.abs(nx), Math.abs(ny));
      const len = Math.min(1, Math.hypot(nx, ny) / Math.SQRT2);
      const dd = box * 0.6 + len * 0.4;
      switch (preset) {
        case 'continent':
          v = v * 0.75 + (1 - Math.pow(dd, 2.2)) * 0.5 - smoothstep(0.8, 1, box) * 0.6;
          break;
        case 'islands': {
          let m = 0;
          for (const c of islandCenters) {
            const d = Math.hypot(x / W - c.x, y / H - c.y) / c.r;
            m = Math.max(m, Math.exp(-d * d * 1.6));
          }
          v = v * 0.55 + m * 0.65 - smoothstep(0.82, 1, box) * 0.6;
          break;
        }
        case 'archipelago':
          v = v * 0.85 + (1 - dd * dd) * 0.2 - smoothstep(0.85, 1, box) * 0.5;
          break;
        case 'coast': {
          const t = coastSide === 0 ? (x / W) : coastSide === 1 ? 1 - x / W : coastSide === 2 ? y / H : 1 - y / H;
          v = v * 0.8 + smoothstep(0, 0.55, t) * 0.55 - (t < 0.05 ? 0.4 : 0);
          break;
        }
        default: // inland: no ocean mask
          break;
      }
      e[y * W + x] = v;
    }
  }

  // ------------------------------------------------------------ 2. sea level
  const sorted = Float32Array.from(e).sort();
  const wf = waterFraction(options);
  const sea = wf <= 0 ? sorted[0]! - 1e-6 : sorted[Math.min(N - 1, Math.floor(wf * (N - 1)))]!;
  const eMin = sorted[0]!;
  const eMax = sorted[N - 1]!;
  const landRange = Math.max(1e-6, eMax - sea);
  const seaRange = Math.max(1e-6, sea - eMin);
  /** Normalized height: land 0..1, water < 0 (depth -1..0). */
  const h = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const v = e[i]!;
    h[i] = v >= sea ? Math.pow((v - sea) / landRange, 1.25) : -(sea - v) / seaRange;
  }
  const terrain = map.terrain;
  for (let i = 0; i < N; i++) terrain[i] = h[i]! < 0 ? Terrain.Water : Terrain.Grass;

  // ------------------------------------------------------------ 3. ocean, flood fill, lakes, flow tree
  let ocean = computeOcean(map);
  const { filled, recv, order } = priorityFlood(W, H, h, ocean);
  const LAKE_DEPTH = 0.018;
  for (let i = 0; i < N; i++) {
    if (terrain[i] !== Terrain.Grass) continue;
    if (filled[i]! - h[i]! > LAKE_DEPTH) terrain[i] = Terrain.Water;
  }
  ocean = computeOcean(map);

  // ------------------------------------------------------------ 4a. moisture (pre-river)
  const distWater = bfsDistance(W, H, (i) => isWaterTerrain(terrain[i]!), undefined, 16);
  const nMoist = createSimplex2D(hashSeed(seed, 'moist'));
  const moisture = new Float32Array(N);
  const mOff = CLIMATE_MOIST[climate];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const m = 0.5 + 0.5 * fbm(nMoist, x * SCALE * 1.3 + 211, y * SCALE * 1.3 - 97, 4);
      moisture[i] = clamp(m + mOff + 0.15 * Math.max(0, 1 - distWater[i]! / 10), 0, 1);
    }

  // ------------------------------------------------------------ 4b. rivers from flow accumulation
  const acc = new Float32Array(N);
  let landCount = 0;
  for (let i = 0; i < N; i++)
    if (!isWaterTerrain(terrain[i]!)) {
      acc[i] = 0.3 + moisture[i]!;
      landCount++;
    }
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]!;
    const p = recv[i]!;
    if (p >= 0) acc[p] += acc[i]!;
  }
  if (landCount > 0) {
    const landAcc: number[] = [];
    for (let i = 0; i < N; i++) if (!isWaterTerrain(terrain[i]!)) landAcc.push(acc[i]!);
    landAcc.sort((a, b) => b - a);
    const riverFrac = preset === 'archipelago' ? 0.02 : 0.034;
    const thr = Math.max(28, landAcc[Math.min(landAcc.length - 1, Math.floor(landAcc.length * riverFrac))]!);
    for (let i = 0; i < N; i++) if (!isWaterTerrain(terrain[i]!) && acc[i]! >= thr) map.flags[i]! |= TileFlag.River;
  }
  const distRiver = bfsDistance(W, H, (i) => (map.flags[i]! & TileFlag.River) !== 0, undefined, 16);

  // ------------------------------------------------------------ 5. warmth
  const nTemp = createSimplex2D(hashSeed(seed, 'temp'));
  const warmth = new Float32Array(N);
  const wBase = CLIMATE_WARMTH[climate];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const lat = y / Math.max(1, H - 1) - 0.5; // north (top) colder
      const alt = Math.max(0, h[i]!);
      warmth[i] = clamp(wBase + lat * 0.35 + 0.08 * nTemp(x * SCALE * 0.8, y * SCALE * 0.8) - alt * 0.32, 0, 1);
      if (distRiver[i]! <= 2) moisture[i] = Math.min(1, moisture[i]! + 0.12);
    }

  // ------------------------------------------------------------ 6. terrain
  const elevation = map.elevation;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const hh = h[i]!;
      if (isWaterTerrain(terrain[i]!)) {
        terrain[i] = ocean[i] && hh < -0.2 && distWater[i] === 0 && !nearLand(terrain, W, H, x, y, 2) ? Terrain.DeepWater : Terrain.Water;
        elevation[i] = clamp(Math.round((SEA_LEVEL - 1) * (1 + Math.min(0, hh))), 0, SEA_LEVEL - 1);
        continue;
      }
      elevation[i] = clamp(SEA_LEVEL + Math.round((255 - SEA_LEVEL) * hh), SEA_LEVEL, 255);
      const m = moisture[i]!;
      const w = warmth[i]!;
      const jitter = hash01(seed, i, 7) * 0.04;
      let t: number;
      if (hh > 0.56 + jitter) t = (w < 0.2 && hh > 0.68) || w < 0.08 ? Terrain.Snow : Terrain.Mountain;
      else if (hh > 0.4 + jitter) t = w < 0.08 ? Terrain.Snow : Terrain.Hills;
      else if (w < 0.1) t = Terrain.Snow;
      else if (hh < 0.035 && touchesOcean(ocean, W, H, x, y) && hash01(seed, i, 3) < 0.85) t = Terrain.Beach;
      else if (m < 0.3 && w > 0.5) t = Terrain.Desert;
      else if (m > 0.78 && hh < 0.08 && w > 0.2) t = Terrain.Swamp;
      else if (m > 0.62 - jitter) t = Terrain.Forest;
      else t = Terrain.Grass;
      terrain[i] = t;
    }

  // ------------------------------------------------------------ 7. fertility & forest
  const nSoil = createSimplex2D(hashSeed(seed, 'soil'));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const t = terrain[i]!;
      if (isWaterTerrain(t)) continue;
      const m = moisture[i]!;
      const w = warmth[i]!;
      const soil = nSoil(x * SCALE * 2.2, y * SCALE * 2.2); // -1..1
      const dr = distRiver[i]!;
      const riverBonus = dr <= 1 ? 40 : dr <= 3 ? 22 : dr <= 6 ? 8 : 0;
      const climateF = w < 0.2 ? 0.55 : w > 0.75 ? 0.8 : 1;
      let f = 0;
      switch (t) {
        case Terrain.Grass:
          f = (95 + 125 * clamp(1 - Math.abs(m - 0.55) * 2.2, 0, 1)) * climateF + soil * 25 + riverBonus;
          break;
        case Terrain.Forest:
          f = 85 + soil * 20 + riverBonus * 0.7;
          break;
        case Terrain.Hills:
          f = 50 + soil * 20 + m * 30 + riverBonus * 0.5;
          break;
        case Terrain.Swamp:
          f = 55 + soil * 10;
          break;
        case Terrain.Desert:
          f = 12 + riverBonus * 1.8;
          break;
        case Terrain.Beach:
          f = 15;
          break;
        case Terrain.Snow:
          f = 5;
          break;
        default:
          f = 0;
      }
      map.fertility[i] = clamp(Math.round(f), 0, 255);
      let fo = 0;
      if (t === Terrain.Forest) fo = 150 + 105 * clamp((m - 0.55) / 0.3, 0, 1) + soil * 15;
      else if (t === Terrain.Swamp) fo = 70;
      else if (t === Terrain.Hills && m > 0.5) fo = 110 * (m - 0.5) * 2;
      else if (t === Terrain.Grass && m > 0.48) fo = hash01(seed, i, 11) < 0.25 ? 20 + 60 * hash01(seed, i, 12) : 0;
      else if (t === Terrain.Mountain && m > 0.6) fo = 25;
      map.forest[i] = clamp(Math.round(fo), 0, 255);
    }

  // ------------------------------------------------------------ 8. coast flags
  computeCoastFlags(map);
  map.seaLevel = SEA_LEVEL;

  // ------------------------------------------------------------ 9. deposits
  placeDeposits(map, data, options);

}

// ============================================================================
// Helpers
// ============================================================================

function nearLand(terrain: Uint8Array, W: number, H: number, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (!isWaterTerrain(terrain[ny * W + nx]!)) return true;
    }
  return false;
}

function touchesOcean(ocean: Uint8Array, W: number, H: number, x: number, y: number): boolean {
  return (x > 0 && ocean[y * W + x - 1] === 1) || (x < W - 1 && ocean[y * W + x + 1] === 1) || (y > 0 && ocean[(y - 1) * W + x] === 1) || (y < H - 1 && ocean[(y + 1) * W + x] === 1);
}

/** Set TileFlag.Coast on land tiles 4-adjacent to any water. */
export function computeCoastFlags(map: MapState): void {
  const W = map.width;
  const H = map.height;
  const t = map.terrain;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      map.flags[i]! &= ~TileFlag.Coast;
      if (isWaterTerrain(t[i]!)) continue;
      if (
        (x > 0 && isWaterTerrain(t[i - 1]!)) ||
        (x < W - 1 && isWaterTerrain(t[i + 1]!)) ||
        (y > 0 && isWaterTerrain(t[i - W]!)) ||
        (y < H - 1 && isWaterTerrain(t[i + W]!))
      )
        map.flags[i]! |= TileFlag.Coast;
    }
}

/**
 * Priority-flood (Barnes et al.) on 4-neighbours seeded from ocean shores and
 * map-border tiles. Returns the depression-filled surface, the receiver (flow
 * target) of every tile and the processing order (receivers come first).
 */
function priorityFlood(W: number, H: number, h: Float32Array, ocean: Uint8Array): { filled: Float32Array; recv: Int32Array; order: Int32Array } {
  const N = W * H;
  const filled = Float32Array.from(h);
  const recv = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const order = new Int32Array(N);
  let on = 0;
  const heap = new MinHeap(N);
  for (let i = 0; i < N; i++) if (ocean[i]) closed[i] = 1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (closed[i]) continue;
      const border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      const shore = (x > 0 && ocean[i - 1]) || (x < W - 1 && ocean[i + 1]) || (y > 0 && ocean[i - W]) || (y < H - 1 && ocean[i + W]);
      if (border || shore) {
        closed[i] = 1;
        heap.push(i, h[i]!);
      }
    }
  const EPS = 1e-5;
  while (heap.size > 0) {
    const c = heap.pop();
    order[on++] = c;
    const x = c % W;
    const y = (c / W) | 0;
    const fc = filled[c]!;
    for (let k = 0; k < 4; k++) {
      let n: number;
      if (k === 0) {
        if (x === 0) continue;
        n = c - 1;
      } else if (k === 1) {
        if (x === W - 1) continue;
        n = c + 1;
      } else if (k === 2) {
        if (y === 0) continue;
        n = c - W;
      } else {
        if (y === H - 1) continue;
        n = c + W;
      }
      if (closed[n]) continue;
      closed[n] = 1;
      recv[n] = c;
      const fn = Math.max(h[n]!, fc + EPS);
      filled[n] = fn;
      heap.push(n, fn);
    }
  }
  return { filled, recv, order: order.subarray(0, on) };
}

/** Binary min-heap of tile indices keyed by float. Ties broken by index (deterministic). */
class MinHeap {
  private idx: Int32Array;
  private key: Float64Array;
  size = 0;
  constructor(cap: number) {
    this.idx = new Int32Array(cap);
    this.key = new Float64Array(cap);
  }
  private less(a: number, b: number): boolean {
    const ka = this.key[a]!;
    const kb = this.key[b]!;
    return ka < kb || (ka === kb && this.idx[a]! < this.idx[b]!);
  }
  private swap(a: number, b: number): void {
    const ti = this.idx[a]!;
    this.idx[a] = this.idx[b]!;
    this.idx[b] = ti;
    const tk = this.key[a]!;
    this.key[a] = this.key[b]!;
    this.key[b] = tk;
  }
  push(i: number, k: number): void {
    let p = this.size++;
    this.idx[p] = i;
    this.key[p] = k;
    while (p > 0) {
      const parent = (p - 1) >> 1;
      if (!this.less(p, parent)) break;
      this.swap(p, parent);
      p = parent;
    }
  }
  pop(): number {
    const top = this.idx[0]!;
    this.size--;
    if (this.size > 0) {
      this.idx[0] = this.idx[this.size]!;
      this.key[0] = this.key[this.size]!;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1;
        const rr = l + 1;
        let m = p;
        if (l < this.size && this.less(l, m)) m = l;
        if (rr < this.size && this.less(rr, m)) m = rr;
        if (m === p) break;
        this.swap(p, m);
        p = m;
      }
    }
    return top;
  }
}

// ============================================================================
// Deposits
// ============================================================================

/** Optional fields a DepositDef may carry (read defensively; data agent may add them). */
interface DepositExtras {
  /** Mean tiles per cluster (default 9). */
  clusterSize?: number;
  /** Explicit cluster count per 128×128 map (overrides frequency-based count). */
  clusters?: number;
}

function depositExtras(def: DepositDef): DepositExtras {
  const d = def as unknown as Record<string, unknown>;
  return {
    clusterSize: typeof d.clusterSize === 'number' ? d.clusterSize : undefined,
    clusters: typeof d.clusters === 'number' ? d.clusters : undefined,
  };
}

/** Deposit defs in a stable order (by id). */
export function sortedDeposits(data: DataRegistry): DepositDef[] {
  return data.depositList().slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Tiles a deposit may occupy: listed terrains (water only if listed), never urban/farmland. */
export function depositTerrainOk(def: DepositDef, t: number): boolean {
  if (t === Terrain.Urban || t === Terrain.Farmland) return false;
  return (def.terrain as readonly number[]).includes(t);
}

/** Palette index of a deposit id in map.depositTypes (adds it when missing, max 255). */
export function depositPaletteIndex(map: MapState, id: string): number {
  let k = map.depositTypes.indexOf(id);
  if (k < 0 && map.depositTypes.length < 256) {
    map.depositTypes.push(id);
    k = map.depositTypes.length - 1;
  }
  return k;
}

/**
 * Grow a deposit blob from (cx,cy). Returns tiles placed.
 * `force` = ignore terrain preference (fairness fallback).
 */
export function growDepositCluster(
  map: MapState,
  def: DepositDef,
  palette: number,
  cx: number,
  cy: number,
  size: number,
  quality: number,
  r: Rng,
  allowTile: (i: number) => boolean = () => true,
): number {
  const W = map.width;
  const H = map.height;
  const start = cy * W + cx;
  if (map.deposit[start] || !depositTerrainOk(def, map.terrain[start]!) || !allowTile(start)) return 0;
  const frontier: number[] = [start];
  const seen = new Set<number>([start]);
  let placed = 0;
  while (frontier.length > 0 && placed < size) {
    const pick = r.int(0, frontier.length - 1);
    const i = frontier[pick]!;
    frontier[pick] = frontier[frontier.length - 1]!;
    frontier.pop();
    if (map.deposit[i] || !depositTerrainOk(def, map.terrain[i]!) || !allowTile(i)) continue;
    const x = i % W;
    const y = (i / W) | 0;
    const centerBoost = 1 + 0.25 * Math.max(0, 1 - Math.hypot(x - cx, y - cy) / 3);
    map.deposit[i] = palette;
    map.depositAmount[i] = Math.round(def.amount * r.range(0.6, 1.4) * centerBoost);
    map.depositQuality[i] = clamp(Math.round((quality + r.range(-0.08, 0.08)) * 255), 13, 255);
    placed++;
    const nbs = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
    for (const n of nbs) if (n >= 0 && !seen.has(n)) {
      seen.add(n);
      frontier.push(n);
    }
  }
  return placed;
}

/** Place deposits for every DepositDef in the registry (generic; unknown ids welcome). */
export function placeDeposits(map: MapState, data: DataRegistry, options: NewGameOptions): void {
  const W = map.width;
  const H = map.height;
  const N = W * H;
  const defs = sortedDeposits(data).slice(0, 255);
  map.depositTypes = ['', ...defs.map((d) => d.id)];
  let land = 0;
  for (let i = 0; i < N; i++) if (!isWaterTerrain(map.terrain[i]!)) land++;
  const areaFactor = (W * H) / (128 * 128);
  const abundance = clamp(options.resourceAbundance || 1, 0.1, 5);

  defs.forEach((def, k) => {
    const palette = k + 1;
    const r = rng(createRng(hashSeed(options.seed, 'deposit', def.id)));
    const ex = depositExtras(def);
    const candidates: number[] = [];
    for (let i = 0; i < N; i++) if (depositTerrainOk(def, map.terrain[i]!)) candidates.push(i);
    if (candidates.length === 0) return;
    const baseCount = ex.clusters !== undefined ? ex.clusters * areaFactor : (land / 1100) * Math.max(0, def.frequency);
    const count = clamp(Math.round(baseCount * abundance), 1, 400);
    const meanSize = clamp(ex.clusterSize ?? 9, 1, 60);
    const nQual = createSimplex2D(hashSeed(options.seed, 'dq', def.id));
    const centers: { x: number; y: number }[] = [];
    const minSep = Math.max(4, Math.sqrt(candidates.length / Math.max(1, count)) * 0.6);
    for (let c = 0; c < count; c++) {
      for (let attempt = 0; attempt < 25; attempt++) {
        const i = candidates[r.int(0, candidates.length - 1)]!;
        if (map.deposit[i]) continue;
        const x = i % W;
        const y = (i / W) | 0;
        if (centers.some((p) => Math.abs(p.x - x) + Math.abs(p.y - y) < minSep)) continue;
        // Regional quality (noise) mixed with per-cluster luck → "location matters".
        const regional = 0.5 + 0.5 * nQual(x * SCALE * 1.5, y * SCALE * 1.5);
        const quality = clamp(0.2 + 0.45 * regional + r.range(0, 0.4), 0.15, 1);
        const size = Math.max(1, Math.round(meanSize * r.range(0.5, 1.6)));
        if (growDepositCluster(map, def, palette, x, y, size, quality, r) > 0) {
          centers.push({ x, y });
          break;
        }
      }
    }
  });
}
