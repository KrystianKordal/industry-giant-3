/**
 * Vehicle simulation: movement along network paths, stops (unload → load →
 * optional wait for full load), congestion, weather, ageing & breakdowns,
 * running costs, statistics. Plus buy / sell / assign.
 *
 * Status machine:
 *   moving ──arrive──▶ unloading ──timer──▶ (load, by route priority) loading ──timer──▶
 *     waitFull && not full ? waiting (retry each tick, max MAX_WAIT_DAYS) : depart → moving
 *   moving + no path → noPath (retry every NO_PATH_RETRY_DAYS)
 *   moving + storm (ships/drones) → waiting (en route) → moving
 *   broken (daily roll) ──timer──▶ moving
 *   idle (no route) · stopped / depot (manual) do nothing.
 */
import type { ActionResult } from '../core/services';
import type { GameContext } from '../core/context';
import { createVehicleRecord } from '../core/entities';
import { addMoney } from '../core/money';
import { notify } from '../core/notify';
import { rng } from '../core/rng';
import type { BuildingId, CompanyId, GameState, Route, RouteId, TileIndex, Vehicle, VehicleId } from '../core/types';
import { clamp, getModifier, pushHistory, stockTotal } from '../core/util';
import { accessTiles, buildingName, stationModeOf, supportsMode } from './access';
import { loadAtStop, loadFraction, unloadAtStop } from './cargo';
import {
  BREAKDOWN_BASE,
  BREAKDOWN_WEAR,
  LOAD_DAYS_BASE,
  LOAD_DAYS_PER_CAPACITY,
  MAX_WAIT_DAYS,
  MIN_CONGESTION_FACTOR,
  MODE_NAMES,
  NO_PATH_RETRY_DAYS,
  PATH_BUDGET_PER_TICK,
  RAIL_CAPACITY,
  RAIL_SPEED_MULT,
  REPAIR_COST_FRACTION,
  ROAD_CAPACITY,
  ROAD_SPEED_MULT,
  TRAFFIC_DECAY,
  TRAFFIC_UNIT,
  WATER_CAPACITY,
} from './constants';
import { canStep, findPathToBuilding } from './pathfinding';
import { rt } from './runtime';

const noPathNotified = new WeakMap<GameState, Set<VehicleId>>();

// ============================================================================
// Helpers
// ============================================================================

/** Tile the vehicle currently occupies. */
export function vehicleTile(state: GameState, v: Vehicle): TileIndex {
  if (v.path.length) return v.path[Math.min(v.pathIndex, v.path.length - 1)]!;
  const W = state.map.width;
  const x = clamp(Math.floor(v.x), 0, W - 1);
  const y = clamp(Math.floor(v.y), 0, state.map.height - 1);
  return y * W + x;
}

/** Vehicles allowed on a tile before slowing down. */
export function tileCapacity(state: GameState, mode: Vehicle['mode'], i: TileIndex): number {
  if (mode === 'road') return ROAD_CAPACITY[state.network.road[i]!] ?? 2;
  if (mode === 'rail') return RAIL_CAPACITY;
  if (mode === 'water') return WATER_CAPACITY;
  return 1000;
}

function weatherAt(state: GameState, x: number, y: number): string {
  const w = state.weather;
  if (!w || !w.regions.length) return 'clear';
  const cx = clamp(Math.floor(x / w.regionSize), 0, w.cols - 1);
  const cy = clamp(Math.floor(y / w.regionSize), 0, w.rows - 1);
  return w.regions[cy * w.cols + cx]?.kind ?? 'clear';
}

/** Storm (weather or world event) at the position — blocks ships and drones. */
export function stormAt(state: GameState, x: number, y: number): boolean {
  if (weatherAt(state, x, y) === 'storm') return true;
  for (const e of state.events.active) {
    if (e.kind !== 'storm' && e.kind !== 'custom') continue;
    if (e.kind === 'custom' && !(e.effects['block.water'] || e.effects['block.ships'])) continue;
    if (!e.area) return true;
    if ((x - e.area.x) ** 2 + (y - e.area.y) ** 2 <= e.area.radius ** 2) return true;
  }
  return false;
}

function weatherSpeed(mode: Vehicle['mode'], kind: string): number {
  switch (kind) {
    case 'storm':
      return mode === 'road' ? 0.7 : mode === 'rail' ? 0.9 : 1;
    case 'snow':
      return mode === 'road' ? 0.75 : mode === 'rail' ? 0.9 : mode === 'air' ? 0.8 : 1;
    case 'rain':
      return mode === 'road' ? 0.9 : 1;
    case 'fog':
      return mode === 'water' || mode === 'air' ? 0.8 : 1;
    default:
      return 1;
  }
}

/** Current speed (tiles/day) of a vehicle before congestion. */
export function baseSpeed(ctx: GameContext, v: Vehicle): number {
  const def = ctx.data.vehicles[v.typeId];
  if (!def) return 0;
  const company = ctx.state.companies[v.owner];
  const i = vehicleTile(ctx.state, v);
  let s = def.speed * getModifier(company, `speed.${v.mode}`) * (0.7 + 0.3 * v.condition);
  if (v.mode === 'road') s *= ROAD_SPEED_MULT[ctx.state.network.road[i]!] ?? 1;
  else if (v.mode === 'rail') s *= RAIL_SPEED_MULT[ctx.state.network.rail[i]!] ?? 1;
  if (v.mode === 'rail' && v.wagons > 0 && def.wagons) s *= 1 - 0.04 * Math.max(0, v.wagons - def.wagons.min);
  return s * envSpeed(ctx, v);
}

/**
 * Weather × world-event speed factor at the vehicle (0 = blocked). Uses
 * ctx.services.world.modifierAt('speed.<mode>') (sampled every few ticks per
 * vehicle); falls back to a built-in weather table when the world reports 1.
 */
const envCache = new WeakMap<GameState, Map<VehicleId, number>>();
export function envSpeed(ctx: GameContext, v: Vehicle): number {
  const state = ctx.state;
  let cache = envCache.get(state);
  if (!cache) envCache.set(state, (cache = new Map()));
  const cached = cache.get(v.id);
  if (cached !== undefined && (state.time.tick + v.id) % 5 !== 0) return cached;
  let f = 1;
  try {
    f = ctx.services.world.modifierAt(`speed.${v.mode}`, Math.floor(v.x), Math.floor(v.y));
  } catch {
    f = 1;
  }
  if (!Number.isFinite(f)) f = 1;
  if (f === 1) f = weatherSpeed(v.mode, weatherAt(state, v.x, v.y));
  if ((v.mode === 'water' || v.mode === 'air') && stormAt(state, v.x, v.y)) f = 0;
  f = Math.max(0, f);
  cache.set(v.id, f);
  return f;
}

/** Days to (un)load `moved` units; stations/hubs with def.loadRate (units/day) may be faster or slower. */
function loadTime(ctx: GameContext, v: Vehicle, moved: number, buildingId: number): number {
  const b = ctx.state.buildings[buildingId];
  const rate = b ? ctx.data.buildings[b.typeId]?.loadRate : undefined;
  if (rate && rate > 0) return LOAD_DAYS_BASE + moved / rate;
  return LOAD_DAYS_BASE + (v.capacity > 0 ? (moved / v.capacity) * LOAD_DAYS_PER_CAPACITY : 0);
}

function tileCenter(W: number, i: TileIndex): [number, number] {
  const x = i % W;
  return [x + 0.5, (i - x) / W + 0.5];
}

// ============================================================================
// Tick system
// ============================================================================

export function vehicleTick(state: GameState, dt: number, ctx: GameContext): void {
  const r = rt(ctx);
  r.pathBudget = PATH_BUDGET_PER_TICK;
  const occ = r.occ;
  for (const t of r.occTiles) occ[t] = 0;
  r.occTiles.length = 0;
  const vehicles = Object.values(state.vehicles);
  for (const v of vehicles) {
    if (v.mode === 'air') continue;
    const t = vehicleTile(state, v);
    if (occ[t]++ === 0) r.occTiles.push(t);
  }
  const loaders: Vehicle[] = [];
  for (const v of vehicles) {
    v.prevX = v.x;
    v.prevY = v.y;
    stepVehicle(ctx, v, dt, loaders);
  }
  if (loaders.length) {
    loaders.sort((a, b) => (state.routes[b.routeId ?? 0]?.priority ?? 0) - (state.routes[a.routeId ?? 0]?.priority ?? 0));
    for (const v of loaders) loadPhase(ctx, v);
  }
}

function stepVehicle(ctx: GameContext, v: Vehicle, dt: number, loaders: Vehicle[]): void {
  switch (v.status) {
    case 'idle':
    case 'stopped':
    case 'depot':
      v.speed = 0;
      return;
    case 'broken':
      v.speed = 0;
      v.timer -= dt;
      if (v.timer <= 0) v.status = 'moving';
      return;
    case 'noPath':
      v.speed = 0;
      v.timer -= dt;
      if (v.timer <= 0) {
        v.status = 'moving';
        v.path = [];
      }
      return;
    case 'unloading':
      v.speed = 0;
      v.timer -= dt;
      if (v.timer <= 0) loaders.push(v);
      return;
    case 'loading':
      v.speed = 0;
      v.timer -= dt;
      if (v.timer <= 0) afterLoading(ctx, v);
      return;
    case 'waiting':
      v.speed = 0;
      if (enRoute(v)) {
        if (envSpeed(ctx, v) > 0) v.status = 'moving';
        return;
      }
      v.timer -= dt;
      loaders.push(v);
      return;
    case 'moving':
      move(ctx, v, dt);
      return;
  }
}

const enRoute = (v: Vehicle): boolean => v.path.length > 1 && v.pathIndex < v.path.length - 1;

function currentRoute(ctx: GameContext, v: Vehicle): Route | null {
  if (!v.routeId) return null;
  return ctx.state.routes[v.routeId] ?? null;
}

/** Plan the path to the current stop. Returns true when the vehicle has a path. */
function planLeg(ctx: GameContext, v: Vehicle, route: Route): boolean {
  const state = ctx.state;
  const n = route.stops.length;
  if (!n) return false;
  if (v.stopIndex >= n || v.stopIndex < 0) v.stopIndex = 0;
  const b = state.buildings[route.stops[v.stopIndex]!.buildingId];
  if (!b) {
    v.stopIndex = (v.stopIndex + 1) % n;
    return false;
  }
  const from = vehicleTile(state, v);
  const p = findPathToBuilding(ctx, v.mode, from, b, true);
  if (p === undefined) return false; // budget exhausted → next tick
  if (p === null) {
    v.status = 'noPath';
    v.timer = NO_PATH_RETRY_DAYS;
    v.path = [];
    let set = noPathNotified.get(state);
    if (!set) noPathNotified.set(state, (set = new Set()));
    if (!set.has(v.id)) {
      set.add(v.id);
      notify(ctx, {
        level: 'warning',
        icon: '🚧',
        title: 'Brak drogi',
        text: `${v.name} nie może dojechać do: ${buildingName(ctx, b)} (${MODE_NAMES[v.mode]}).`,
        target: { kind: 'vehicle', id: v.id },
        companyId: v.owner,
        category: 'logistics',
      });
    }
    return false;
  }
  noPathNotified.get(state)?.delete(v.id);
  v.path = p.slice();
  v.pathIndex = 0;
  v.pathProgress = 0;
  if (p.length === 1) {
    const [cx, cy] = tileCenter(state.map.width, p[0]!);
    v.x = cx;
    v.y = cy;
    arrive(ctx, v, route);
    return false;
  }
  return true;
}

function move(ctx: GameContext, v: Vehicle, dt: number): void {
  const state = ctx.state;
  const route = currentRoute(ctx, v);
  if (!route) {
    v.status = 'idle';
    v.path = [];
    v.speed = 0;
    return;
  }
  if (!route.enabled || !route.stops.length) {
    v.speed = 0;
    return;
  }
  if (v.path.length === 0 || v.pathIndex >= v.path.length - 1) {
    if (v.path.length > 1 && v.pathIndex >= v.path.length - 1) {
      arrive(ctx, v, route);
      return;
    }
    if (!planLeg(ctx, v, route)) return;
  }
  if (envSpeed(ctx, v) <= 0) {
    // storm / blocked waterway: wait en route
    v.status = 'waiting';
    v.speed = 0;
    return;
  }
  const W = state.map.width;
  const r = rt(ctx);
  let speed = baseSpeed(ctx, v);
  const next = v.path[v.pathIndex + 1];
  if (next !== undefined && v.mode !== 'air') {
    const o = r.occ[next]!;
    const cap = tileCapacity(state, v.mode, next);
    if (o >= cap) speed *= Math.max(MIN_CONGESTION_FACTOR, cap / (o + 1));
  }
  v.speed = speed;
  let remaining = speed * dt;
  const path = v.path;
  while (remaining > 1e-9 && v.pathIndex < path.length - 1) {
    const a = path[v.pathIndex]!;
    const b = path[v.pathIndex + 1]!;
    if (v.pathProgress === 0 && !canStep(state, ctx.data, v.mode, a, b)) {
      // network changed under us → re-plan from here
      v.path = [];
      v.pathIndex = 0;
      const [cx, cy] = tileCenter(W, a);
      v.x = cx;
      v.y = cy;
      planLeg(ctx, v, route);
      return;
    }
    const ax = a % W;
    const ay = (a - ax) / W;
    const bx = b % W;
    const by = (b - bx) / W;
    const seg = Math.hypot(bx - ax, by - ay) || 1;
    const need = (1 - v.pathProgress) * seg;
    if (remaining >= need) {
      remaining -= need;
      v.pathIndex++;
      v.pathProgress = 0;
      enterTile(ctx, v, b, seg);
    } else {
      v.pathProgress += remaining / seg;
      remaining = 0;
    }
  }
  // position & heading
  const pi = v.pathIndex;
  if (pi >= path.length - 1) {
    const [cx, cy] = tileCenter(W, path[path.length - 1]!);
    v.x = cx;
    v.y = cy;
    arrive(ctx, v, route);
    return;
  }
  const [ax, ay] = tileCenter(W, path[pi]!);
  const [bx, by] = tileCenter(W, path[pi + 1]!);
  v.x = ax + (bx - ax) * v.pathProgress;
  v.y = ay + (by - ay) * v.pathProgress;
  v.heading = Math.atan2(by - ay, bx - ax);
}

function enterTile(ctx: GameContext, v: Vehicle, i: TileIndex, seg: number): void {
  const state = ctx.state;
  const def = ctx.data.vehicles[v.typeId];
  v.stats.distanceMonth += seg;
  if (v.mode === 'road' || v.mode === 'rail') {
    const t = state.network.traffic;
    t[i] = Math.min(65535, t[i]! + TRAFFIC_UNIT);
  }
  if (def && def.emissions > 0) {
    const e = def.emissions * seg * getModifier(state.companies[v.owner], 'emissions.vehicles');
    const c = state.companies[v.owner];
    if (c) c.emissionsMonth += e;
    if (v.mode !== 'air') state.map.pollution[i]! += e * 0.05;
  }
}

function arrive(ctx: GameContext, v: Vehicle, route: Route): void {
  const state = ctx.state;
  const stop = route.stops[v.stopIndex];
  v.path = [];
  v.pathIndex = 0;
  v.pathProgress = 0;
  v.speed = 0;
  if (!stop) {
    v.stopIndex = 0;
    return;
  }
  const b = state.buildings[stop.buildingId];
  v.status = 'unloading';
  if (!b) {
    v.timer = 0;
    return;
  }
  ctx.bus.emit('vehicle:arrived', { vehicleId: v.id, buildingId: b.id });
  const moved = unloadAtStop(ctx, v, route, v.stopIndex);
  if (moved > 0) {
    v.stats.tripsMonth++;
    route.stats.tripsMonth++;
    if (v.owner === state.playerCompanyId) ctx.bus.emit('sfx', { id: v.mode === 'rail' ? 'train' : v.mode === 'water' ? 'ship' : 'truck', x: v.x, y: v.y, volume: 0.5 });
  }
  v.timer = moved > 0 ? loadTime(ctx, v, moved, b.id) : 0.1;
}

/** Load (in route-priority order). Called for 'unloading' (timer done) and 'waiting' vehicles. */
function loadPhase(ctx: GameContext, v: Vehicle): void {
  const route = currentRoute(ctx, v);
  if (!route) {
    v.status = 'idle';
    return;
  }
  if (v.status === 'unloading') {
    const moved = loadAtStop(ctx, v, route, v.stopIndex);
    v.status = 'loading';
    v.timer = moved > 0 ? loadTime(ctx, v, moved, route.stops[v.stopIndex]?.buildingId ?? 0) : 0.1;
    return;
  }
  // waiting for full load
  loadAtStop(ctx, v, route, v.stopIndex);
  const stop = route.stops[v.stopIndex];
  const target = stop && stop.minLoad > 0 ? stop.minLoad : 1;
  if (loadFraction(v) >= target - 1e-6 || v.timer <= 0) depart(ctx, v, route);
}

function afterLoading(ctx: GameContext, v: Vehicle): void {
  const route = currentRoute(ctx, v);
  if (!route) {
    v.status = 'idle';
    return;
  }
  const stop = route.stops[v.stopIndex];
  const target = stop && stop.minLoad > 0 ? stop.minLoad : 1;
  if (stop?.waitFull && loadFraction(v) < target - 1e-6) {
    v.status = 'waiting';
    v.timer = MAX_WAIT_DAYS;
    return;
  }
  depart(ctx, v, route);
}

function depart(ctx: GameContext, v: Vehicle, route: Route): void {
  const r = rt(ctx);
  const f = loadFraction(v);
  if (stockTotal(v.cargo) > 0 || route.stops[v.stopIndex]?.orders.some((o) => o.action === 'load')) {
    const prev = r.routeLoad.get(route.id);
    r.routeLoad.set(route.id, prev === undefined ? f : prev * 0.8 + f * 0.2);
  }
  v.stopIndex = route.stops.length ? (v.stopIndex + 1) % route.stops.length : 0;
  v.status = 'moving';
  v.path = [];
  v.pathIndex = 0;
  v.pathProgress = 0;
  v.timer = 0;
}

// ============================================================================
// Daily / monthly
// ============================================================================

export function vehicleDaily(state: GameState, _dt: number, ctx: GameContext): void {
  const R = rng(state.rng);
  const costs = new Map<CompanyId, number>();
  const repairs = new Map<CompanyId, number>();
  for (const v of Object.values(state.vehicles)) {
    const def = ctx.data.vehicles[v.typeId];
    if (!def) continue;
    const company = state.companies[v.owner];
    v.ageDays += 1;
    const lifeDays = Math.max(1, def.lifespanYears) * 360;
    const active = v.status === 'moving' || v.status === 'loading' || v.status === 'unloading' || v.status === 'waiting';
    const wear = (0.6 / lifeDays) * (v.ageDays > lifeDays ? 2.5 : 1) * (active ? 1 : 0.3);
    v.condition = Math.max(0, v.condition - wear);
    // breakdowns
    if (v.status === 'moving') {
      const p = (BREAKDOWN_BASE + (1 - v.condition) ** 2 * BREAKDOWN_WEAR) * getModifier(company, 'breakdown.vehicles');
      if (R.chance(p)) {
        v.status = 'broken';
        v.timer = R.range(1, 4);
        v.condition = Math.min(1, v.condition + 0.08);
        const repair = Math.round(def.cost * REPAIR_COST_FRACTION);
        repairs.set(v.owner, (repairs.get(v.owner) ?? 0) + repair);
        v.stats.costMonth += repair;
        ctx.bus.emit('vehicle:broken', { vehicleId: v.id });
        notify(ctx, {
          level: 'info',
          icon: '🔧',
          title: 'Awaria pojazdu',
          text: `${v.name} zepsuł się i jest naprawiany.`,
          target: { kind: 'vehicle', id: v.id },
          companyId: v.owner,
          category: 'logistics',
          silent: true,
        });
      }
    }
    // running costs
    let c = (def.upkeep + (def.wagons ? v.wagons * def.wagons.costPerWagon * 0.02 : 0)) / 30;
    c *= getModifier(company, 'upkeep.vehicles');
    if (v.status === 'idle' || v.status === 'stopped' || v.status === 'depot') c *= 0.5;
    v.stats.costMonth += c;
    const route = v.routeId ? state.routes[v.routeId] : undefined;
    if (route) route.stats.costMonth += c;
    costs.set(v.owner, (costs.get(v.owner) ?? 0) + c);
  }
  for (const [owner, c] of costs) if (c > 0) addMoney(ctx, owner, -Math.round(c * 100) / 100, 'vehicleUpkeep');
  for (const [owner, c] of repairs) if (c > 0) addMoney(ctx, owner, -c, 'vehicleUpkeep');
  // traffic decay
  const t = state.network.traffic;
  for (let i = 0; i < t.length; i++) {
    const v = t[i]!;
    if (v) t[i] = v > 8 ? Math.round(v * TRAFFIC_DECAY) : v - 1;
  }
}

export function vehicleMonthly(state: GameState): void {
  for (const v of Object.values(state.vehicles)) {
    const s = v.stats;
    pushHistory(s.profitHistory, Math.round(s.revenueMonth - s.costMonth));
    s.tripsMonth = 0;
    s.deliveredMonth = 0;
    s.revenueMonth = 0;
    s.costMonth = 0;
    s.distanceMonth = 0;
  }
  for (const r of Object.values(state.routes)) {
    const s = r.stats;
    pushHistory(s.profitHistory, Math.round(s.revenueMonth - s.costMonth));
    let units = 0;
    for (const k in s.deliveredMonth) units += s.deliveredMonth[k]!;
    pushHistory(s.throughputHistory, Math.round(units));
    s.tripsMonth = 0;
    s.deliveredMonth = {};
    s.revenueMonth = 0;
    s.costMonth = 0;
  }
}

// ============================================================================
// Buy / sell / assign
// ============================================================================

export interface BuyOptions {
  /** Building where the vehicle appears (depot / station). */
  depotId?: BuildingId;
  /** Train wagons (clamped to def.wagons). */
  wagons?: number;
}

/** Full price of a vehicle incl. wagons (trains pay costPerWagon for every wagon). */
export function vehiclePrice(ctx: GameContext, typeId: string, wagons?: number): number {
  const def = ctx.data.vehicles[typeId];
  if (!def) return Infinity;
  if (!def.wagons) return def.cost;
  const w = clamp(Math.round(wagons ?? def.wagons.min), def.wagons.min, def.wagons.max);
  return def.cost + w * def.wagons.costPerWagon;
}

/** Current resale value. */
export function sellValue(ctx: GameContext, v: Vehicle): number {
  const def = ctx.data.vehicles[v.typeId];
  if (!def) return 0;
  const price = vehiclePrice(ctx, v.typeId, v.wagons);
  const ageFactor = Math.max(0.15, 1 - v.ageDays / (Math.max(1, def.lifespanYears) * 360));
  return Math.round(price * 0.6 * ageFactor * (0.5 + 0.5 * v.condition));
}

function spawnTile(ctx: GameContext, companyId: CompanyId, mode: Vehicle['mode'], route: Route | null, depotId?: BuildingId): { tile: TileIndex; depot: BuildingId } | null {
  const state = ctx.state;
  const candidates: number[] = [];
  if (depotId) candidates.push(depotId);
  if (route) for (const s of route.stops) candidates.push(s.buildingId);
  for (const b of Object.values(state.buildings)) {
    if (b.owner !== companyId) continue;
    const m = stationModeOf(ctx.data.buildings[b.typeId]);
    if (m === mode) candidates.push(b.id);
  }
  if (mode === 'road') for (const b of Object.values(state.buildings)) if (b.owner === companyId) candidates.push(b.id);
  for (const id of candidates) {
    const b = state.buildings[id];
    if (!b || !supportsMode(ctx.data.buildings[b.typeId], mode)) continue;
    const acc = accessTiles(ctx, b, mode);
    if (acc.length) return { tile: acc[0]!, depot: b.id };
  }
  return null;
}

export function buyVehicle(ctx: GameContext, companyId: CompanyId, typeId: string, routeId: RouteId | null, opts: BuyOptions = {}): ActionResult<{ id: VehicleId }> {
  const state = ctx.state;
  const def = ctx.data.vehicles[typeId];
  if (!def) return { ok: false, reason: 'Nieznany pojazd' };
  const company = state.companies[companyId];
  if (!company) return { ok: false, reason: 'Nieznana firma' };
  if (company.bankrupt) return { ok: false, reason: 'Firma jest bankrutem' };
  if (!ctx.services.economy.isUnlocked(companyId, 'vehicle', typeId)) return { ok: false, reason: `${def.name}: niedostępny (epoka lub badania)` };
  const route = routeId ? (state.routes[routeId] ?? null) : null;
  if (routeId && !route) return { ok: false, reason: 'Nieznana trasa' };
  if (route && route.owner !== companyId) return { ok: false, reason: 'To trasa innej firmy' };
  if (route && route.mode !== def.mode) return { ok: false, reason: `Pojazd nie pasuje do trasy (transport ${MODE_NAMES[route.mode]})` };
  const wagons = def.wagons ? clamp(Math.round(opts.wagons ?? def.wagons.min), def.wagons.min, def.wagons.max) : 0;
  const cost = vehiclePrice(ctx, typeId, wagons);
  const spawn = spawnTile(ctx, companyId, def.mode, route, opts.depotId);
  if (!spawn) {
    const need = def.mode === 'road' ? 'budynek przy drodze' : def.mode === 'rail' ? 'stacja kolejowa przy torach' : def.mode === 'water' ? 'port nad wodą' : 'port dronów';
    return { ok: false, reason: `Brak miejsca startu (potrzebny ${need})` };
  }
  if (company.cash < cost) return { ok: false, reason: 'Brak środków' };
  addMoney(ctx, companyId, -cost, 'vehiclePurchase');
  const W = state.map.width;
  const v = createVehicleRecord(state, ctx.data, typeId, companyId, spawn.tile % W, Math.floor(spawn.tile / W));
  v.wagons = wagons;
  v.capacity = def.wagons ? def.capacity * wagons : def.capacity;
  v.depotId = spawn.depot;
  state.vehicles[v.id] = v;
  if (route) {
    v.routeId = route.id;
    v.status = 'moving';
    // start at the stop nearest to the spawn point
    const idx = route.stops.findIndex((s) => s.buildingId === spawn.depot);
    v.stopIndex = idx >= 0 ? idx : 0;
    route.vehicleIds.push(v.id);
    ctx.bus.emit('route:changed', { routeId: route.id });
  }
  ctx.bus.emit('vehicle:bought', { vehicleId: v.id });
  if (companyId === state.playerCompanyId) ctx.bus.emit('sfx', { id: 'cash' });
  return { ok: true, cost, id: v.id };
}

export function sellVehicle(ctx: GameContext, vehicleId: VehicleId): ActionResult {
  const state = ctx.state;
  const v = state.vehicles[vehicleId];
  if (!v) return { ok: false, reason: 'Nieznany pojazd' };
  const value = sellValue(ctx, v);
  detachFromRoute(ctx, v);
  delete state.vehicles[vehicleId];
  if (value > 0) addMoney(ctx, v.owner, value, 'assetSale');
  ctx.bus.emit('vehicle:sold', { vehicleId, owner: v.owner });
  return { ok: true, cost: -value };
}

function detachFromRoute(ctx: GameContext, v: Vehicle): void {
  if (!v.routeId) return;
  const r = ctx.state.routes[v.routeId];
  if (r) {
    r.vehicleIds = r.vehicleIds.filter((id) => id !== v.id);
    ctx.bus.emit('route:changed', { routeId: r.id });
  }
  v.routeId = null;
}

export function assignVehicle(ctx: GameContext, vehicleId: VehicleId, routeId: RouteId | null): boolean {
  const state = ctx.state;
  const v = state.vehicles[vehicleId];
  if (!v) return false;
  if (routeId === null) {
    detachFromRoute(ctx, v);
    v.status = 'idle';
    v.path = [];
    v.pathIndex = 0;
    v.pathProgress = 0;
    return true;
  }
  const route = state.routes[routeId];
  if (!route || route.owner !== v.owner || route.mode !== v.mode) return false;
  if (v.routeId === routeId) return true;
  detachFromRoute(ctx, v);
  v.routeId = routeId;
  route.vehicleIds.push(v.id);
  v.stopIndex = 0;
  v.status = 'moving';
  v.path = [];
  v.pathIndex = 0;
  v.pathProgress = 0;
  ctx.bus.emit('route:changed', { routeId });
  return true;
}

/** Best unlocked vehicle type for a mode that the company can afford (by capacity×speed). */
export function pickVehicleType(ctx: GameContext, companyId: CompanyId, mode: Vehicle['mode'], budget?: number): string | null {
  const company = ctx.state.companies[companyId];
  if (!company) return null;
  const cash = budget ?? company.cash;
  let best: string | null = null;
  let bestScore = -1;
  for (const def of ctx.data.vehicleList()) {
    if (def.mode !== mode) continue;
    if (!ctx.services.economy.isUnlocked(companyId, 'vehicle', def.id)) continue;
    if (vehiclePrice(ctx, def.id) > cash) continue;
    const cap = def.wagons ? def.capacity * def.wagons.min : def.capacity;
    const score = cap * def.speed;
    if (score > bestScore) {
      bestScore = score;
      best = def.id;
    }
  }
  return best;
}
