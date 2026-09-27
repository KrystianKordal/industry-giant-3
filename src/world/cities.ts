/**
 * Cities: placement (new-game step 'cities'), urban layout (roads + houses),
 * demographics, demand and the monthly city simulation.
 *
 * Contract with economy (shops):
 *  - city.demand[productId].monthly  = units the city wants this month
 *  - shops ADD sold units to demand.suppliedMonth and demand.shareByCompany[companyId]
 *    during the month; demand.price is the local price per unit.
 *  - the monthly 'cities' system (SystemOrder.cities = 550, after market 500)
 *    closes the month: suppliedMonth → satisfaction/history, then resets
 *    suppliedMonth = 0 and shareByCompany = {}.
 *  - labour.employed is written by economy (workforce); world only reads it.
 */
import type { DataRegistry } from '../data/registry';
import type { ProductDef } from '../data/defs';
import type { GameContext } from '../core/context';
import { createCityRecord, cityPopulation } from '../core/entities';
import { notify } from '../core/notify';
import { createRng, hashSeed, rng } from '../core/rng';
import {
  RoadKind,
  Terrain,
  TileFlag,
  type City,
  type CityDemand,
  type CityTier,
  type Difficulty,
  type GameState,
  type NewGameOptions,
  type SocialClass,
} from '../core/types';
import { clamp, pushHistory } from '../core/util';
import { ChangeSet, placeRoad } from './changes';
import { eventAdditive, eventModifier } from './effects';
import { bfsDistance, computeLandmasses, computeOcean, isWaterTerrain } from './mapinfo';
import { generateCityNames } from './names';
import { hash01 } from './noise';
import { ensureFairness } from './fairness';

// ============================================================================
// Tunables
// ============================================================================

/** People housed per house tile by density level 0..5. */
export const HOUSE_CAPACITY = [0, 60, 150, 320, 650, 1300] as const;
/** Grid spacing of city streets (2×2 house blocks between streets). */
const STREET_SPACING = 3;
const MAX_CITY_RADIUS = 40;

/** Class shares by era index (poor, middle, rich). */
const CLASS_SHARES: [number, number, number][] = [
  [0.65, 0.3, 0.05],
  [0.58, 0.35, 0.07],
  [0.5, 0.4, 0.1],
  [0.42, 0.45, 0.13],
  [0.36, 0.48, 0.16],
];
const WAGE_BY_ERA = [55, 80, 130, 220, 340];
const PARTICIPATION = [0.5, 0.48, 0.46, 0.45, 0.44];
const NEUTRAL_SATISFACTION: Record<Difficulty, number> = { easy: 0.26, normal: 0.3, hard: 0.34 };
const CATEGORY_WEIGHT: Partial<Record<string, number>> = { food: 1.4, consumer: 1, luxury: 0.7, electronics: 0.9, energy: 1.1, digital: 0.8 };

const eraIdxOf = (data: DataRegistry, state: GameState): number => Math.max(0, data.eraIndex(state.time.eraId));
const sharesFor = (eraIdx: number): [number, number, number] => CLASS_SHARES[clamp(eraIdx, 0, CLASS_SHARES.length - 1)]!;

export function tierFor(pop: number): CityTier {
  return pop < 2500 ? 'village' : pop < 12000 ? 'town' : pop < 60000 ? 'city' : 'metropolis';
}

export const TIER_NAMES: Record<CityTier, string> = { village: 'wieś', town: 'miasteczko', city: 'miasto', metropolis: 'metropolia' };

/** 0 (all poor) .. ~3 (all rich). */
export function cityWealth(c: City): number {
  const pop = Math.max(1, cityPopulation(c));
  return (c.population.middle + 3 * c.population.rich) / pop;
}

/** Number of cities for options (cityCount is the reference for a 128×128 map). */
export function cityCountFor(options: NewGameOptions, W: number, H: number): number {
  const sf = Math.sqrt(W * H) / 128;
  const n = Math.round((options.cityCount || 8) * (0.55 + 0.45 * sf));
  return options.cityCount >= 6 ? clamp(n, 6, 14) : clamp(n, 1, 14);
}

// ============================================================================
// Placement (new-game step)
// ============================================================================

const CENTER_OK = new Set<number>([Terrain.Grass, Terrain.Beach, Terrain.Forest, Terrain.Hills, Terrain.Desert]);
const LAND_OK = new Set<number>([Terrain.Grass, Terrain.Beach, Terrain.Forest, Terrain.Hills, Terrain.Desert, Terrain.Snow]);

export function generateCities(state: GameState, options: NewGameOptions, ctx: GameContext): void {
  const data = ctx.data;
  const map = state.map;
  const W = map.width;
  const H = map.height;
  const N = W * H;
  const r = rng(createRng(hashSeed(options.seed, 'cities')));
  state.cities = {};
  state.nextIds.city = 1;

  const lm = computeLandmasses(map);
  const ocean = computeOcean(map);
  const distRiver = bfsDistance(W, H, (i) => (map.flags[i]! & TileFlag.River) !== 0, undefined, 12);
  const distOcean = bfsDistance(W, H, (i) => ocean[i] === 1, undefined, 10);
  const distLake = bfsDistance(W, H, (i) => isWaterTerrain(map.terrain[i]!) && !ocean[i], undefined, 6);

  // Prefix sums over buildable-land mask and fertility for window queries.
  const W1 = W + 1;
  const sumB = new Int32Array(W1 * (H + 1));
  const sumF = new Float64Array(W1 * (H + 1));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const t = map.terrain[i]!;
      const b = LAND_OK.has(t) && !(map.flags[i]! & TileFlag.River) ? 1 : 0;
      const j = (y + 1) * W1 + (x + 1);
      sumB[j] = b + sumB[j - 1]! + sumB[j - W1]! - sumB[j - W1 - 1]!;
      sumF[j] = map.fertility[i]! + sumF[j - 1]! + sumF[j - W1]! - sumF[j - W1 - 1]!;
    }
  const rect = (s: Int32Array | Float64Array, x0: number, y0: number, x1: number, y1: number): number => {
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(W - 1, x1);
    y1 = Math.min(H - 1, y1);
    return s[(y1 + 1) * W1 + x1 + 1]! - s[y0 * W1 + x1 + 1]! - s[(y1 + 1) * W1 + x0]! + s[y0 * W1 + x0]!;
  };

  let landArea = 0;
  for (let i = 0; i < N; i++) if (!isWaterTerrain(map.terrain[i]!)) landArea++;

  const margin = Math.min(5, Math.floor(Math.min(W, H) / 8));
  const cands: { i: number; s: number }[] = [];
  for (let y = margin; y < H - margin; y++)
    for (let x = margin; x < W - margin; x++) {
      const i = y * W + x;
      const t = map.terrain[i]!;
      if (!CENTER_OK.has(t) || map.flags[i]! & TileFlag.River || map.deposit[i]) continue;
      const lmSize = lm.sizes[lm.id[i]!] ?? 0;
      if (lmSize < 60) continue;
      const frac = rect(sumB, x - 4, y - 4, x + 4, y + 4) / 81;
      if (frac < 0.55) continue;
      const fert = rect(sumF, x - 6, y - 6, x + 6, y + 6) / 169 / 255;
      const dr = distRiver[i]!;
      const doc = distOcean[i]!;
      let s = 1.5 * frac + 2 * fert;
      s += dr <= 2 ? 1.2 : dr <= 5 ? 0.6 : 0;
      s += doc <= 3 ? 0.9 : doc <= 6 ? 0.3 : 0;
      s += distLake[i]! <= 3 ? 0.3 : 0;
      s += t === Terrain.Hills ? -0.8 : t === Terrain.Forest ? -0.3 : t === Terrain.Desert ? -0.6 : 0;
      s += 0.35 * Math.log10(lmSize);
      s += hash01(options.seed, i, 101) * 0.6;
      cands.push({ i, s });
    }
  cands.sort((a, b) => b.s - a.s || a.i - b.i);

  const want = cityCountFor(options, W, H);
  let minDist = clamp(Math.sqrt(landArea / Math.max(1, want)) * 0.75, 9, 36);
  if (Math.min(W, H) < 64) minDist = Math.min(minDist, Math.min(W, H) / 3);
  const chosen: number[] = [];
  for (let pass = 0; pass < 5 && chosen.length < want; pass++) {
    for (const c of cands) {
      if (chosen.length >= want) break;
      const x = c.i % W;
      const y = (c.i / W) | 0;
      let ok = true;
      for (const o of chosen) {
        if (Math.hypot((o % W) - x, ((o / W) | 0) - y) < minDist) {
          ok = false;
          break;
        }
      }
      if (ok) chosen.push(c.i);
    }
    minDist = Math.max(6, minDist * 0.8);
  }
  if (chosen.length === 0) {
    // Degenerate map: take any land tile.
    for (let i = 0; i < N; i++)
      if (LAND_OK.has(map.terrain[i]!)) {
        chosen.push(i);
        break;
      }
  }

  const names = generateCityNames(r, chosen.length);
  const eraIdx = eraIdxOf(data, state);
  const eraMul = 1 + eraIdx * 0.8;
  const shares = sharesFor(eraIdx);
  chosen.forEach((i, k) => {
    const x = i % W;
    const y = (i / W) | 0;
    const capital = k === 0;
    const pop = Math.round((capital ? r.range(9000, 14000) : 1500 + 5500 * Math.pow(r.next(), 1.7)) * eraMul);
    const city = createCityRecord(state, names[k]!, x, y, pop);
    city.foundedYear = state.time.year - r.int(80, 600);
    city.population = splitPopulation(pop, shares);
    city.tier = tierFor(pop);
    city.isPort = distOcean[i]! <= 4;
    city.regionId = regionIndex(state, x, y);
    city.greenPreference = clamp(0.05 + 0.12 * eraIdx, 0, 1);
    city.labour = {
      workforce: Math.round(pop * PARTICIPATION[eraIdx]!),
      employed: 0,
      wage: WAGE_BY_ERA[eraIdx]!,
      skill: clamp(0.3 + 0.1 * eraIdx, 0, 1),
      commuteRadius: 10 + eraIdx * 3,
    };
    city.radius = 1;
    state.cities[city.id] = city;
    developCity(state, data, city, null);
    refreshCityDemand(state, data, city);
  });

  ensureFairness(state, data, options, lm);
  state.network.version++;
}

function splitPopulation(pop: number, shares: [number, number, number]): Record<SocialClass, number> {
  const poor = Math.round(pop * shares[0]);
  const rich = Math.round(pop * shares[2]);
  return { poor, middle: Math.max(0, pop - poor - rich), rich };
}

export function regionIndex(state: GameState, x: number, y: number): number {
  const w = state.weather;
  const cx = Math.min(w.cols - 1, Math.max(0, Math.floor(x / w.regionSize)));
  const cy = Math.min(w.rows - 1, Math.max(0, Math.floor(y / w.regionSize)));
  return cy * w.cols + cx;
}

// ============================================================================
// Urban layout
// ============================================================================

const mod = (a: number, n: number): number => ((a % n) + n) % n;
const isStreet = (dx: number, dy: number): boolean => mod(dx, STREET_SPACING) === 0 || mod(dy, STREET_SPACING) === 0;

function maxDensity(tier: CityTier, eraIdx: number, q: number): number {
  const tierMax = tier === 'village' ? 2 : tier === 'town' ? 3 : tier === 'city' ? 4 : 5;
  const base = Math.min(tierMax, [3, 4, 5, 5, 5][clamp(eraIdx, 0, 4)]!);
  const d = q < 0.35 ? base : q < 0.7 ? base - 1 : base - 2;
  return clamp(d, 1, 5);
}

/** Can the city use this tile (road or house)? Respects player buildings, rails, other cities. */
function urbanizable(state: GameState, idx: number, cityId: number): boolean {
  const map = state.map;
  const t = map.terrain[idx]!;
  if (isWaterTerrain(t) || t === Terrain.Mountain || t === Terrain.Farmland) return false;
  if (map.building[idx] || state.network.rail[idx]) return false;
  if (map.flags[idx]! & (TileFlag.Blocked | TileFlag.Damaged)) return false;
  const owner = map.city[idx]!;
  return owner === 0 || owner === cityId;
}

function houseable(state: GameState, idx: number, cityId: number): boolean {
  const map = state.map;
  if (!urbanizable(state, idx, cityId)) return false;
  if (state.network.road[idx] || map.house[idx]) return false;
  if (map.deposit[idx] || map.flags[idx]! & TileFlag.River) return false;
  return true;
}

export function cityCapacity(state: GameState, city: City): number {
  let cap = 0;
  for (const i of city.houses) cap += HOUSE_CAPACITY[state.map.house[i]!] ?? 0;
  return cap;
}

/** Remove houses that became invalid (player building / road / rail on them). Returns count. */
export function pruneHouses(state: GameState, city: City, cs: ChangeSet | null): number {
  const map = state.map;
  const W = map.width;
  let removed = 0;
  city.houses = city.houses.filter((i) => {
    const ok = map.house[i]! > 0 && !map.building[i] && !state.network.road[i] && !state.network.rail[i];
    if (!ok) {
      map.house[i] = 0;
      removed++;
      if (cs) cs.touch(i % W, (i / W) | 0);
    }
    return ok;
  });
  return removed;
}

function setUrban(state: GameState, idx: number, cityId: number): void {
  const map = state.map;
  if (!(map.flags[idx]! & TileFlag.River)) map.terrain[idx] = Terrain.Urban;
  map.forest[idx] = 0;
  map.city[idx] = cityId;
}

/** Lay street grid within radius R (BFS from the centre over street tiles). */
function layStreets(state: GameState, city: City, R: number, eraIdx: number, cs: ChangeSet | null): Set<number> {
  const map = state.map;
  const W = map.width;
  const H = map.height;
  const reached = new Set<number>();
  const cIdx = city.y * W + city.x;
  if (!urbanizable(state, cIdx, city.id) && !state.network.road[cIdx]) return reached;
  const queue = [cIdx];
  reached.add(cIdx);
  const kindFor = (dx: number, dy: number): 1 | 2 => (eraIdx >= 2 || dx === 0 || dy === 0 ? RoadKind.Paved : RoadKind.Dirt);
  for (let qh = 0; qh < queue.length; qh++) {
    const i = queue[qh]!;
    const x = i % W;
    const y = (i / W) | 0;
    const want = kindFor(x - city.x, y - city.y);
    if (!state.network.road[i] || (state.network.owner[i] === 0 && state.network.road[i]! < want)) placeRoad(state, i, want, cs);
    setUrban(state, i, city.id);
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (reached.has(n)) continue;
      const rx = nx - city.x;
      const ry = ny - city.y;
      if (!isStreet(rx, ry) || Math.hypot(rx, ry) > R) continue;
      if (!state.network.road[n] && !urbanizable(state, n, city.id)) continue;
      if (map.house[n]) continue;
      reached.add(n);
      queue.push(n);
    }
  }
  return reached;
}

/**
 * Grow (or shrink) the physical city to house its population:
 * new houses next to streets → densify inner houses → widen radius (new streets).
 * Never removes roads; decline only lowers densities.
 */
export function developCity(state: GameState, data: DataRegistry, city: City, cs: ChangeSet | null): void {
  const map = state.map;
  const W = map.width;
  const H = map.height;
  const eraIdx = eraIdxOf(data, state);
  const pop = cityPopulation(city);
  let cap = cityCapacity(state, city);
  let R = Math.max(1, Math.round(city.radius));

  if (cap > pop * 1.6 && city.houses.length > 0) {
    // Decline: thin out outer houses (a few per call).
    const byDist = city.houses.slice().sort((a, b) => distTo(city, b, W) - distTo(city, a, W));
    let steps = Math.max(1, Math.round(city.houses.length * 0.05));
    for (const i of byDist) {
      if (cap <= pop * 1.3 || steps <= 0) break;
      const d = map.house[i]!;
      if (d > 1) {
        map.house[i] = d - 1;
        cap -= HOUSE_CAPACITY[d]! - HOUSE_CAPACITY[d - 1]!;
        steps--;
        if (cs) cs.touch(i % W, (i / W) | 0);
      }
    }
    return;
  }

  let guard = 0;
  while (cap < pop && guard++ < MAX_CITY_RADIUS) {
    const streets = layStreets(state, city, R, eraIdx, cs);
    // 1) new houses adjacent to reached streets, closest (jittered) first
    const cands: { i: number; k: number }[] = [];
    const seen = new Set<number>();
    for (const s of streets) {
      const sx = s % W;
      const sy = (s / W) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = sx + dx;
          const ny = sy + dy;
          if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          if (seen.has(n)) continue;
          seen.add(n);
          const d = Math.hypot(nx - city.x, ny - city.y);
          if (d > R + 0.5 || !houseable(state, n, city.id)) continue;
          cands.push({ i: n, k: d + hash01(state.map.seed, n, 7) * 1.5 });
        }
    }
    cands.sort((a, b) => a.k - b.k || a.i - b.i);
    for (const c of cands) {
      if (cap >= pop) break;
      map.house[c.i] = 1;
      setUrban(state, c.i, city.id);
      city.houses.push(c.i);
      cap += HOUSE_CAPACITY[1];
      if (cs) cs.touch(c.i % W, (c.i / W) | 0);
    }
    if (cap >= pop) break;
    // 2) densify: inner houses first
    const tier = tierFor(pop);
    const houses = city.houses.slice().sort((a, b) => distTo(city, a, W) - distTo(city, b, W));
    for (let level = 2; level <= 5 && cap < pop; level++) {
      for (const i of houses) {
        if (cap >= pop) break;
        const d = map.house[i]!;
        if (d >= level) continue;
        const q = distTo(city, i, W) / Math.max(1, R);
        if (maxDensity(tier, eraIdx, q) < level) continue;
        map.house[i] = level;
        cap += HOUSE_CAPACITY[level]! - HOUSE_CAPACITY[d]!;
        if (cs) cs.touch(i % W, (i / W) | 0);
      }
    }
    if (cap >= pop || R >= MAX_CITY_RADIUS) break;
    R++;
  }
  if (R !== city.radius) {
    city.radius = R;
    claimArea(state, city, cs);
  }
}

function distTo(city: City, i: number, W: number): number {
  return Math.hypot((i % W) - city.x, ((i / W) | 0) - city.y);
}

/** Mark tiles within radius+1 as belonging to the city (map.city) where unclaimed. */
function claimArea(state: GameState, city: City, cs: ChangeSet | null): void {
  const map = state.map;
  const W = map.width;
  const H = map.height;
  const R = city.radius + 1;
  for (let y = Math.max(0, city.y - R); y <= Math.min(H - 1, city.y + R); y++)
    for (let x = Math.max(0, city.x - R); x <= Math.min(W - 1, city.x + R); x++) {
      if (Math.hypot(x - city.x, y - city.y) > R) continue;
      const i = y * W + x;
      if (map.city[i] || isWaterTerrain(map.terrain[i]!)) continue;
      map.city[i] = city.id;
      if (cs) cs.touch(x, y);
    }
}

// ============================================================================
// Demand
// ============================================================================

function eraAgeFactor(diff: number): number {
  return diff <= 1 ? 1 : Math.max(0.4, 1 - 0.15 * (diff - 1));
}

/** Stable per-city preference multiplier (0.75..1.25) for a product. */
function preferenceFor(state: GameState, city: City, productId: string): number {
  const p = city.preferences[productId];
  if (p !== undefined) return p;
  const v = Math.round((0.75 + 0.5 * hash01(hashSeed(state.map.seed, productId), city.id, 17)) * 100) / 100;
  city.preferences[productId] = v;
  return v;
}

/** Products cities consume in the current era (have `consumption`, era reached). */
export function consumerProducts(data: DataRegistry, eraIdx: number): ProductDef[] {
  return data.productList().filter((p) => p.consumption && data.eraIndex(p.era) <= eraIdx);
}

/** Recompute demand (monthly units + local price) for a city. Keeps accumulators & history. */
export function refreshCityDemand(state: GameState, data: DataRegistry, city: City): void {
  const eraIdx = eraIdxOf(data, state);
  const month = state.time.month;
  const wealthF = 0.85 + 0.3 * cityWealth(city);
  const products = consumerProducts(data, eraIdx);
  const wanted = new Set<string>();
  const demandAll = eventModifier(state, 'demand.all', null, city.id);
  for (const p of products) {
    const cons = p.consumption!;
    let base = 0;
    for (const cls of ['poor', 'middle', 'rich'] as const) base += (city.population[cls] / 1000) * (cons[cls] ?? 0);
    if (base <= 0) continue;
    wanted.add(p.id);
    const seasonal = p.seasonal?.[month - 1] ?? 1;
    const green = p.green ? 1 + city.greenPreference * 0.5 : 1;
    const ev = demandAll * eventModifier(state, `demand.${p.id}`, null, city.id) * eventModifier(state, `demand.${p.category}`, null, city.id);
    const monthly = base * preferenceFor(state, city, p.id) * seasonal * eraAgeFactor(eraIdx - data.eraIndex(p.era)) * green * ev;
    const d: CityDemand = (city.demand[p.id] ??= {
      monthly: 0,
      suppliedMonth: 0,
      satisfaction: 0,
      price: 0,
      shareByCompany: {},
      history: [],
    });
    d.monthly = Math.round(monthly * 100) / 100;
    const market = state.market.products[p.id]?.price ?? p.basePrice;
    const scarcity = 0.95 + 0.3 * (1 - d.satisfaction);
    d.price = Math.round(market * scarcity * wealthF * 100) / 100;
  }
  for (const id of Object.keys(city.demand)) if (!wanted.has(id)) delete city.demand[id];
}

export function refreshAllDemand(state: GameState, data: DataRegistry): void {
  for (const c of Object.values(state.cities)) refreshCityDemand(state, data, c);
}

// ============================================================================
// Monthly simulation
// ============================================================================

/** Weighted supply satisfaction 0..1 of a city (value-weighted, food heavier). */
export function supplyScore(data: DataRegistry, city: City): number {
  let sw = 0;
  let s = 0;
  for (const [pid, d] of Object.entries(city.demand)) {
    const cat = data.products[pid]?.category ?? 'consumer';
    const w = d.monthly * Math.sqrt(Math.max(0.01, d.price)) * (CATEGORY_WEIGHT[cat] ?? 1);
    sw += w;
    s += w * d.satisfaction;
  }
  return sw > 0 ? s / sw : 0;
}

function cityPollution(state: GameState, city: City): number {
  const tiles = city.houses;
  if (tiles.length === 0) return state.map.pollution[city.y * state.map.width + city.x] ?? 0;
  const step = Math.max(1, Math.floor(tiles.length / 48));
  let sum = 0;
  let n = 0;
  for (let k = 0; k < tiles.length; k += step) {
    sum += state.map.pollution[tiles[k]!]!;
    n++;
  }
  return sum / Math.max(1, n);
}

/** Close the demand month: satisfaction EMA, history, reset accumulators. */
export function closeDemandMonth(city: City): void {
  for (const d of Object.values(city.demand)) {
    const ratio = d.monthly > 0 ? Math.min(1, d.suppliedMonth / d.monthly) : 1;
    d.satisfaction = Math.round((d.satisfaction * 0.5 + ratio * 0.5) * 1000) / 1000;
    pushHistory(d.history, Math.round(ratio * 1000) / 1000);
    d.suppliedMonth = 0;
    d.shareByCompany = {};
  }
}

/** One month of city life (called by the 'cities' system; exported for tests). */
export function updateCityMonthly(ctx: GameContext, state: GameState, city: City, cs: ChangeSet): void {
  const data = ctx.data;
  const eraIdx = eraIdxOf(data, state);
  pruneHouses(state, city, cs);
  closeDemandMonth(city);

  const pop = cityPopulation(city);
  const supply = supplyScore(data, city);
  const jobs = clamp(city.labour.employed / Math.max(1, city.labour.workforce * 0.3), 0, 1);
  const poll = cityPollution(state, city);
  const pollPenalty = clamp(poll / 200, 0, 0.3) * (0.5 + city.greenPreference);
  const evSat = eventAdditive(state, 'satisfaction', null, city.id);
  const target = clamp(0.22 + 0.6 * supply + 0.1 * jobs - pollPenalty + evSat, 0, 1);
  city.satisfaction = Math.round((city.satisfaction * 0.6 + target * 0.4) * 1000) / 1000;

  // Growth: satisfaction above the neutral point grows the city, below shrinks it (slower).
  const neutral = NEUTRAL_SATISFACTION[state.settings.difficulty] ?? 0.3;
  let g = (city.satisfaction - neutral) * 0.035;
  if (g < 0) g *= 0.5;
  g *= 1 / (1 + pop / 400000);
  g *= eventModifier(state, 'growth', null, city.id);
  city.growthRate = Math.round(clamp(g, -0.02, 0.03) * 10000) / 10000;

  const newPop = Math.max(50, Math.round(pop * (1 + city.growthRate)));
  // Class drift toward era target, tilted by satisfaction (wealthy when well supplied).
  const base = sharesFor(eraIdx);
  const tilt = (city.satisfaction - 0.5) * 0.2;
  const tgt: [number, number, number] = [
    clamp(base[0] - tilt, 0.15, 0.9),
    clamp(base[1] + tilt * 0.7, 0.08, 0.7),
    clamp(base[2] + tilt * 0.3, 0.01, 0.35),
  ];
  const sum = tgt[0] + tgt[1] + tgt[2];
  const cur: [number, number, number] = [city.population.poor / Math.max(1, pop), city.population.middle / Math.max(1, pop), city.population.rich / Math.max(1, pop)];
  const next = cur.map((c, k) => c + (tgt[k]! / sum - c) * 0.03) as [number, number, number];
  const prevPop = pop;
  city.population = splitPopulation(newPop, next);

  // Labour pool.
  const total = cityPopulation(city);
  const empRate = city.labour.workforce > 0 ? city.labour.employed / city.labour.workforce : 0;
  city.labour.workforce = Math.round(total * PARTICIPATION[eraIdx]!);
  city.labour.wage = Math.round(WAGE_BY_ERA[eraIdx]! * (0.8 + 0.25 * cityWealth(city)) * (1 + 0.3 * clamp(empRate, 0, 1)) * eventModifier(state, 'wages.all', null, city.id));
  const skillTarget = clamp(0.3 + 0.1 * eraIdx + 0.15 * cityWealth(city), 0, 1);
  city.labour.skill = Math.round((city.labour.skill + (skillTarget - city.labour.skill) * 0.05) * 1000) / 1000;
  city.labour.commuteRadius = Math.round(10 + eraIdx * 3 + city.radius * 0.5);
  city.greenPreference = Math.round(clamp(0.05 + 0.12 * eraIdx + state.ecology.awareness * 0.4 + (city.population.rich / Math.max(1, total)) * 0.3, 0, 1) * 1000) / 1000;

  // Tier + events.
  const oldTier = city.tier;
  city.tier = tierFor(total);
  if (total > prevPop) ctx.bus.emit('city:grew', { cityId: city.id, population: total, previous: prevPop });
  const order: CityTier[] = ['village', 'town', 'city', 'metropolis'];
  if (order.indexOf(city.tier) > order.indexOf(oldTier)) {
    notify(ctx, {
      level: 'success',
      icon: '🏙️',
      title: `${city.name} rośnie!`,
      text: `${city.name} jest teraz: ${TIER_NAMES[city.tier]} (${total.toLocaleString('pl-PL')} mieszkańców).`,
      target: { kind: 'city', id: city.id },
      category: 'city',
    });
  }

  developCity(state, data, city, cs);
  refreshCityDemand(state, data, city);
  pushHistory(city.history.population, total);
  pushHistory(city.history.satisfaction, city.satisfaction);
  pushHistory((state.stats.monthly[`city.${city.id}.population`] ??= []), total);
}

export function citiesMonthlySystem(state: GameState, ctx: GameContext): void {
  const cs = new ChangeSet();
  for (const city of Object.values(state.cities)) updateCityMonthly(ctx, state, city, cs);
  cs.flush(ctx);
}
