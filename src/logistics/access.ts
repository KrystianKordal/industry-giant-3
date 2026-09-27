/**
 * Access rules: which transport modes a building serves, where vehicles stop
 * (access tiles), station catchment, and which products a building accepts.
 *
 *  - road:  every building; access = road tiles 4-adjacent to the footprint.
 *  - rail:  stations with stationMode 'rail'; access = rail tiles adjacent to the footprint.
 *  - water: harbors (stationMode 'water', or station/warehouse/export with requiresWater);
 *           access = water / river tiles adjacent to the footprint.
 *  - air:   drone ports (stationMode 'air'); access = footprint center.
 *  Stations of rail/water/air collect from / deliver to own buildings within
 *  their catchment (def.radius, default DEFAULT_CATCHMENT; or hub.linked if set).
 */
import type { GameContext } from '../core/context';
import { TileFlag, type Building, type GameState, type ProductId, type TileIndex, type TransportMode } from '../core/types';
import type { BuildingDef, ProductCategory } from '../data/defs';
import type { DataRegistry } from '../data/registry';
import { DEFAULT_CATCHMENT } from './constants';

/** Transport mode a station building serves (null = not a station for rail/water/air). */
export function stationModeOf(def: BuildingDef | undefined): TransportMode | null {
  if (!def) return null;
  if (def.stationMode) return def.stationMode;
  const hubLike = def.category === 'station' || def.category === 'warehouse' || def.category === 'export';
  if (!hubLike) return null;
  if (def.requiresWater) return 'water';
  if (def.category !== 'station') return null;
  // Fallback for defs without stationMode: guess from the id.
  const id = def.id.toLowerCase();
  if (/drone|air/.test(id)) return 'air';
  if (/harbo|dock|seaport|^port/.test(id)) return 'water';
  if (/rail|train/.test(id)) return 'rail';
  return null;
}

/** Modes a building type supports (always includes road). */
export function buildingModes(def: BuildingDef | undefined): TransportMode[] {
  const m = stationModeOf(def);
  return m && m !== 'road' ? ['road', m] : ['road'];
}

export function supportsMode(def: BuildingDef | undefined, mode: TransportMode): boolean {
  return mode === 'road' ? !!def : stationModeOf(def) === mode;
}

export const isWaterTile = (state: GameState, data: DataRegistry, i: TileIndex): boolean =>
  !!data.terrain[state.map.terrain[i]!]?.isWater || (state.map.flags[i]! & TileFlag.River) !== 0;

/** Tiles 4-adjacent to the footprint (the ring without corners). */
export function ringTiles(state: GameState, b: Pick<Building, 'x' | 'y' | 'w' | 'h'>): TileIndex[] {
  const { width: W, height: H } = state.map;
  const out: TileIndex[] = [];
  const add = (x: number, y: number): void => {
    if (x >= 0 && y >= 0 && x < W && y < H) out.push(y * W + x);
  };
  for (let x = b.x; x < b.x + b.w; x++) {
    add(x, b.y - 1);
    add(x, b.y + b.h);
  }
  for (let y = b.y; y < b.y + b.h; y++) {
    add(b.x - 1, y);
    add(b.x + b.w, y);
  }
  return out;
}

export function centerTile(state: GameState, b: Building): TileIndex {
  return Math.floor(b.y + b.h / 2) * state.map.width + Math.floor(b.x + b.w / 2);
}

/** Tiles where a vehicle of `mode` can stop to serve building b. */
export function accessTiles(ctx: GameContext, b: Building, mode: TransportMode): TileIndex[] {
  const state = ctx.state;
  const def = ctx.data.buildings[b.typeId];
  if (!supportsMode(def, mode)) return [];
  const net = state.network;
  const dmg = (i: number): boolean => (state.map.flags[i]! & TileFlag.Damaged) !== 0;
  switch (mode) {
    case 'road':
      return ringTiles(state, b).filter((i) => net.road[i]! > 0 && !dmg(i));
    case 'rail':
      return ringTiles(state, b).filter((i) => net.rail[i]! > 0 && !dmg(i));
    case 'water':
      return ringTiles(state, b).filter((i) => isWaterTile(state, ctx.data, i));
    case 'air':
      return [centerTile(state, b)];
  }
}

/** Catchment radius of a station (0 = serves only itself). */
export function catchmentRadius(def: BuildingDef | undefined): number {
  if (!def) return 0;
  const m = stationModeOf(def);
  if (!m || m === 'road') return def.category === 'station' && def.radius ? def.radius : 0;
  return def.radius ?? DEFAULT_CATCHMENT;
}

/**
 * Own buildings served by a station (excluding the station). Uses hub.linked when
 * set, otherwise every building of the same owner overlapping the catchment square.
 */
export function catchment(ctx: GameContext, station: Building): Building[] {
  const state = ctx.state;
  const def = ctx.data.buildings[station.typeId];
  const r = catchmentRadius(def);
  if (r <= 0) return [];
  if (station.hub && station.hub.linked.length) {
    return station.hub.linked.map((id) => state.buildings[id]).filter((b): b is Building => !!b && b.owner === station.owner && b.id !== station.id);
  }
  const { width: W, height: H } = state.map;
  const seen = new Set<number>();
  const out: Building[] = [];
  const x0 = Math.max(0, station.x - r);
  const y0 = Math.max(0, station.y - r);
  const x1 = Math.min(W - 1, station.x + station.w - 1 + r);
  const y1 = Math.min(H - 1, station.y + station.h - 1 + r);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const id = state.map.building[y * W + x]!;
      if (!id || id === station.id || seen.has(id)) continue;
      seen.add(id);
      const b = state.buildings[id];
      if (b && b.owner === station.owner) out.push(b);
    }
  return out;
}

/** Stations of `mode` owned by b.owner whose catchment covers b. */
export function stationsServing(ctx: GameContext, b: Building, mode: TransportMode): Building[] {
  const out: Building[] = [];
  for (const s of Object.values(ctx.state.buildings)) {
    if (s.owner !== b.owner || s.id === b.id) continue;
    const def = ctx.data.buildings[s.typeId];
    if (stationModeOf(def) !== mode) continue;
    if (catchment(ctx, s).some((c) => c.id === b.id)) out.push(s);
  }
  return out;
}

// ============================================================================
// Goods acceptance
// ============================================================================

const SHOP_CATEGORIES: ProductCategory[] = ['food', 'consumer', 'luxury', 'electronics'];

export const isHub = (def: BuildingDef | undefined): boolean =>
  !!def && (def.category === 'warehouse' || def.category === 'station' || def.category === 'export');

export const isCompleted = (b: Building): boolean => b.constructionProgress >= 1;

/**
 * Where product p would go when delivered to building b: 'input' (factory/shop
 * consumption), 'storage' (hubs), or null (not accepted).
 */
export function acceptSlot(ctx: GameContext, b: Building, p: ProductId, ignoreConstruction = false): 'input' | 'storage' | null {
  if (!ignoreConstruction && !isCompleted(b)) return null;
  const data = ctx.data;
  const def = data.buildings[b.typeId];
  if (!def) return null;
  if (def.category === 'shop') {
    const prod = data.products[p];
    if (!prod) return null;
    const ok = def.sells && def.sells.length ? def.sells.includes(p) : SHOP_CATEGORIES.includes(prod.category);
    if (!ok) return null;
    if (b.shop && b.shop.assortment.length && !b.shop.assortment.includes(p)) return null;
    return 'input';
  }
  if (isHub(def)) {
    if (def.capacity <= 0) return null;
    const acc = b.hub?.accept ?? 'all';
    return acc === 'all' || acc.includes(p) ? 'storage' : null;
  }
  const recipe = b.recipeId ? data.recipes[b.recipeId] : undefined;
  if (recipe && recipe.inputs.some((io) => io.product === p)) return 'input';
  return null;
}

/** Free room for product p in building b (units). */
export function freeRoom(ctx: GameContext, b: Building, p: ProductId, slot: 'input' | 'storage'): number {
  const def = ctx.data.buildings[b.typeId];
  if (!def) return 0;
  const cap = slot === 'storage' ? b.hub?.limits[p] || def.capacity : def.capacity;
  const cur = (slot === 'storage' ? b.storage : b.input)[p]?.qty ?? 0;
  return Math.max(0, cap * Math.max(1, b.level) - cur);
}

/** Products a building can hand out (output + hub storage above reserve). */
export function availableProducts(ctx: GameContext, b: Building): ProductId[] {
  if (!isCompleted(b)) return [];
  const out = new Set<ProductId>();
  for (const k in b.output) if (b.output[k]!.qty > 1e-6) out.add(k);
  if (b.hub) for (const k in b.storage) if (b.storage[k]!.qty - (b.hub.reserve[k] ?? 0) > 1e-6) out.add(k);
  return [...out];
}

/** Products building type produces (recipe outputs) — for suggestions & auto orders. */
export function producedProducts(ctx: GameContext, b: Building): ProductId[] {
  const r = b.recipeId ? ctx.data.recipes[b.recipeId] : undefined;
  const set = new Set<ProductId>();
  if (r) for (const io of [...r.outputs, ...(r.byproducts ?? [])]) set.add(io.product);
  for (const k in b.output) set.add(k);
  if (b.hub) for (const k in b.storage) set.add(k);
  return [...set];
}

export function buildingName(ctx: GameContext, b: Building): string {
  return b.name ?? ctx.data.buildings[b.typeId]?.name ?? `Budynek #${b.id}`;
}
