/**
 * Small pure helpers shared by all modules (tiles, stock, history, modifiers).
 * Pure functions only — safe to use in systems, UI and tests.
 */
import { HISTORY_MONTHS } from './constants';
import type { Company, GameState, IdCounters, MapState, Stock, StockEntry, TileIndex, TilePos } from './types';

// ---------------------------------------------------------------- math
export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by);
/** Manhattan distance. */
export const manhattan = (ax: number, ay: number, bx: number, by: number): number => Math.abs(ax - bx) + Math.abs(ay - by);

// ---------------------------------------------------------------- tiles
export const tileIndex = (map: Pick<MapState, 'width'>, x: number, y: number): TileIndex => y * map.width + x;
export const tileXY = (map: Pick<MapState, 'width'>, idx: TileIndex): TilePos => ({ x: idx % map.width, y: Math.floor(idx / map.width) });
export const inBounds = (map: Pick<MapState, 'width' | 'height'>, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < map.width && y < map.height;

/** Iterate tile indices of a rect clipped to the map. */
export function forEachTileInRect(
  map: Pick<MapState, 'width' | 'height'>,
  x: number,
  y: number,
  w: number,
  h: number,
  fn: (idx: TileIndex, tx: number, ty: number) => void,
): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(map.width, x + w);
  const y1 = Math.min(map.height, y + h);
  for (let ty = y0; ty < y1; ty++) for (let tx = x0; tx < x1; tx++) fn(ty * map.width + tx, tx, ty);
}

/** 4-neighbour offsets N, E, S, W (matches Dir.N/E/S/W bit order). */
export const DIR4: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
/** 8-neighbour offsets N, E, S, W, NE, SE, SW, NW (matches Dir bit order). */
export const DIR8: readonly [number, number][] = [...DIR4, [1, -1], [1, 1], [-1, 1], [-1, -1]];

// ---------------------------------------------------------------- ids
/** Allocate a new id of a given kind (ids start at 1). */
export function newId(state: GameState, kind: keyof IdCounters): number {
  const id = state.nextIds[kind];
  state.nextIds[kind] = id + 1;
  return id;
}

// ---------------------------------------------------------------- stock
/** Units of product in stock (0 if missing). */
export const stockQty = (s: Stock, productId: string): number => s[productId]?.qty ?? 0;
/** Sum of all units in a stock. */
export function stockTotal(s: Stock): number {
  let t = 0;
  for (const k in s) t += s[k]!.qty;
  return t;
}
/** Weighted average of two qualities. */
export function mixQuality(qtyA: number, qualA: number, qtyB: number, qualB: number): number {
  const t = qtyA + qtyB;
  return t > 0 ? (qtyA * qualA + qtyB * qualB) / t : (qualA + qualB) / 2;
}
/** Add units with quality to a stock (mixes quality). */
export function addStock(s: Stock, productId: string, qty: number, quality: number): void {
  if (qty <= 0) return;
  const e = s[productId];
  if (!e) {
    s[productId] = { qty, quality };
    return;
  }
  e.quality = mixQuality(e.qty, e.quality, qty, quality);
  e.qty += qty;
}
/**
 * Remove up to `qty` units. Returns what was actually taken (qty + its quality).
 * Entries reaching ~0 are deleted to keep saves small.
 */
export function takeStock(s: Stock, productId: string, qty: number): StockEntry {
  const e = s[productId];
  if (!e || qty <= 0) return { qty: 0, quality: e?.quality ?? 0.5 };
  const taken = Math.min(e.qty, qty);
  e.qty -= taken;
  const quality = e.quality;
  if (e.qty <= 1e-6) delete s[productId];
  return { qty: taken, quality };
}
/** Move up to qty units from one stock to another. Returns moved units. */
export function moveStock(from: Stock, to: Stock, productId: string, qty: number): number {
  const t = takeStock(from, productId, qty);
  addStock(to, productId, t.qty, t.quality);
  return t.qty;
}

// ---------------------------------------------------------------- history
/** Push a value onto a capped history array (oldest first). */
export function pushHistory(arr: number[], value: number, max: number = HISTORY_MONTHS): void {
  arr.push(value);
  if (arr.length > max) arr.splice(0, arr.length - max);
}

// ---------------------------------------------------------------- modifiers
/**
 * Read a company modifier ("<effect>.<target>"). Falls back to "<effect>.all",
 * then to `def`. Modifiers are multiplicative by convention (1 = neutral).
 */
export function getModifier(company: Company | undefined, key: string, def = 1): number {
  if (!company) return def;
  const m = company.modifiers;
  if (key in m) return m[key]!;
  const effect = key.split('.')[0];
  const all = `${effect}.all`;
  return all in m ? m[all]! : def;
}

// ---------------------------------------------------------------- misc
/** Shallow-safe deep clone of plain JSON data (no typed arrays!). */
export const cloneJson = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
