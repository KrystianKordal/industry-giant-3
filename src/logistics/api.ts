/**
 * Read-only logistics API for render / UI / AI (fast, allocation-light).
 * Import from 'src/logistics/api'. All functions are safe to call every frame.
 *
 * See docs/CONTRACTS.md → "Logistyka — API".
 */
import type { GameContext } from '../core/context';
import type { Building, BuildingId, GameState, ProductId, RouteId, TileIndex, TransportMode, Vehicle, VehicleStatus } from '../core/types';
import { lerp, stockTotal } from '../core/util';
import type { BuildingDef } from '../data/defs';
import { accessTiles as accessTilesOf, buildingModes, catchment, catchmentRadius, stationModeOf } from './access';
import { loadFraction } from './cargo';
import { TRAFFIC_REF } from './constants';
import { findBuildingPath } from './pathfinding';
import { tryRt } from './runtime';
import { sellValue, tileCapacity, vehiclePrice } from './vehicles';

export { Dir } from '../core/types';
export { DIR_BITS, bestLevel, levelName, levelUnlocked, maxLevel } from './network';
export { vehiclePrice };

// ---------------------------------------------------------------- network masks
/** Road level (0 none, 1 dirt, 2 paved, 3 highway). */
export const roadLevel = (state: GameState, i: TileIndex): number => state.network.road[i]!;
/** Rail level (0 none, 1 standard, 2 electrified, 3 high-speed). */
export const railLevel = (state: GameState, i: TileIndex): number => state.network.rail[i]!;
/** Road connection mask (Dir.N|E|S|W). Roads connect to every adjacent road. */
export const roadMask = (state: GameState, i: TileIndex): number => state.network.roadConn[i]!;
/** Rail connection mask (Dir.N|E|S|W; diagonal bits unused for now). */
export const railMask = (state: GameState, i: TileIndex): number => state.network.railConn[i]!;

/**
 * Road mask including stubs into adjacent buildings (for drawing driveways):
 * bit set also where the neighbour tile is a building footprint.
 */
export function roadMaskWithBuildings(state: GameState, i: TileIndex): number {
  let m = state.network.roadConn[i]!;
  if (!state.network.road[i]) return 0;
  const W = state.map.width;
  const H = state.map.height;
  const x = i % W;
  const y = (i - x) / W;
  const b = state.map.building;
  if (y > 0 && b[i - W]) m |= 1;
  if (x < W - 1 && b[i + 1]) m |= 2;
  if (y < H - 1 && b[i + W]) m |= 4;
  if (x > 0 && b[i - 1]) m |= 8;
  return m;
}

// ---------------------------------------------------------------- vehicles
export interface VehiclePose {
  /** Interpolated position in TILE units (multiply by TILE_SIZE for world px). */
  x: number;
  y: number;
  /** Radians, 0 = east, clockwise (screen coords). */
  heading: number;
}

/** Interpolated pose (alpha = rc.alpha). Pass `out` to avoid allocation. */
export function vehiclePose(v: Vehicle, alpha: number, out: VehiclePose = { x: 0, y: 0, heading: 0 }): VehiclePose {
  out.x = lerp(v.prevX, v.x, alpha);
  out.y = lerp(v.prevY, v.y, alpha);
  out.heading = v.heading;
  return out;
}

/** Product with the most units on board (null = empty). */
export function vehicleMainCargo(v: Vehicle): ProductId | null {
  let best: ProductId | null = null;
  let q = 0;
  for (const k in v.cargo) {
    const e = v.cargo[k]!;
    if (e.qty > q) {
      q = e.qty;
      best = k;
    }
  }
  return best;
}

/** 0..1 fill of the vehicle. */
export const vehicleLoad = (v: Vehicle): number => loadFraction(v);
export const vehicleCargoUnits = (v: Vehicle): number => stockTotal(v.cargo);
export const vehicleSellValue = (ctx: GameContext, v: Vehicle): number => sellValue(ctx, v);
export const isVehicleMoving = (v: Vehicle): boolean => v.status === 'moving';

export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
  idle: 'Bez trasy',
  moving: 'W drodze',
  loading: 'Załadunek',
  unloading: 'Rozładunek',
  waiting: 'Oczekuje',
  noPath: 'Brak drogi',
  broken: 'Awaria',
  depot: 'W zajezdni',
  stopped: 'Zatrzymany',
};

/** Polish status label; 'waiting' distinguishes storm vs full-load wait. */
export function vehicleStatusLabel(v: Vehicle): string {
  if (v.status === 'waiting' && v.path.length > 1 && v.pathIndex < v.path.length - 1) return 'Czeka (sztorm)';
  if (v.status === 'waiting') return 'Czeka na pełny ładunek';
  return VEHICLE_STATUS_LABELS[v.status];
}

/** Id of the building the vehicle heads to / is at (0 = none). */
export function vehicleTarget(state: GameState, v: Vehicle): BuildingId {
  const r = v.routeId ? state.routes[v.routeId] : undefined;
  return r?.stops[v.stopIndex]?.buildingId ?? 0;
}

// ---------------------------------------------------------------- congestion / traffic
/** Vehicles currently on the tile (runtime occupancy, updated every tick). */
export function tileOccupancy(ctx: GameContext, i: TileIndex): number {
  const r = tryRt(ctx);
  return r ? r.occ[i]! : 0;
}

/** Occupancy / capacity for the tile (>1 = congested). Uses road capacity when a road exists. */
export function congestionAt(ctx: GameContext, i: TileIndex): number {
  const st = ctx.tryState();
  const r = tryRt(ctx);
  if (!st || !r) return 0;
  const o = r.occ[i]!;
  if (!o) return 0;
  const mode: TransportMode = st.network.road[i] ? 'road' : st.network.rail[i] ? 'rail' : 'water';
  return o / tileCapacity(st, mode, i);
}

/** Raw occupancy array (do not mutate) — for heatmaps. null when no game. */
export function occupancyArray(ctx: GameContext): Uint16Array | null {
  return tryRt(ctx)?.occ ?? null;
}

/** Recent traffic 0..1 (network.traffic normalized) — for heatmap overlays. */
export const trafficLevel = (state: GameState, i: TileIndex): number => Math.min(1, state.network.traffic[i]! / TRAFFIC_REF);

export interface RouteUtilisation {
  vehicles: number;
  /** EMA of the load fraction on departure (0..1). */
  avgLoad: number;
  /** Avg congestion (occupancy/capacity) over the tiles where its vehicles are now. */
  congestion: number;
  /** Units delivered last closed month. */
  throughput: number;
  /** Vehicles currently without a path. */
  noPath: number;
}

export function routeUtilisation(ctx: GameContext, routeId: RouteId): RouteUtilisation {
  const st = ctx.state;
  const r = st.routes[routeId];
  const res: RouteUtilisation = { vehicles: 0, avgLoad: 0, congestion: 0, throughput: 0, noPath: 0 };
  if (!r) return res;
  const rtm = tryRt(ctx);
  res.vehicles = r.vehicleIds.length;
  res.avgLoad = rtm?.routeLoad.get(routeId) ?? 0;
  res.throughput = r.stats.throughputHistory[r.stats.throughputHistory.length - 1] ?? 0;
  let c = 0;
  for (const id of r.vehicleIds) {
    const v = st.vehicles[id];
    if (!v) continue;
    if (v.status === 'noPath') res.noPath++;
    const W = st.map.width;
    c += congestionAt(ctx, Math.floor(v.y) * W + Math.floor(v.x));
  }
  res.congestion = res.vehicles ? c / res.vehicles : 0;
  return res;
}

/**
 * Tile paths of each leg of a route (stop k → stop k+1), cached. For drawing
 * route lines. null legs = not connected. Air legs = [from, to].
 */
export function routeLegs(ctx: GameContext, routeId: RouteId): (TileIndex[] | null)[] {
  const st = ctx.state;
  const r = st.routes[routeId];
  if (!r) return [];
  const legs: (TileIndex[] | null)[] = [];
  const n = r.stops.length;
  for (let k = 0; k < n; k++) {
    if (n === 2 && k === 1) {
      const back = legs[0];
      legs.push(back ? [...back].reverse() : null);
      break;
    }
    const a = st.buildings[r.stops[k]!.buildingId];
    const b = st.buildings[r.stops[(k + 1) % n]!.buildingId];
    legs.push(a && b ? findBuildingPath(ctx, r.mode, a, b) : null);
  }
  return legs;
}

// ---------------------------------------------------------------- buildings
/** Transport modes a building type supports (always 'road'). */
export const buildingTransportModes = (def: BuildingDef | undefined): TransportMode[] => buildingModes(def);
/** Station mode of a building type (null = not a rail/water/air station). */
export const stationMode = (def: BuildingDef | undefined): TransportMode | null => stationModeOf(def);
/** Catchment radius (0 = none). */
export const stationRadius = (def: BuildingDef | undefined): number => catchmentRadius(def);
/** Buildings served by a station. */
export const stationCatchment = (ctx: GameContext, b: Building): Building[] => catchment(ctx, b);
/** Tiles where vehicles of `mode` stop at a building (road tiles next to it, rail next to station…). */
export const accessTiles = (ctx: GameContext, b: Building, mode: TransportMode): TileIndex[] => accessTilesOf(ctx, b, mode);
/** Has the building road access? */
export const hasRoadAccess = (ctx: GameContext, b: Building): boolean => accessTilesOf(ctx, b, 'road').length > 0;
