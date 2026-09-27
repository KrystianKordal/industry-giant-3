/**
 * Routes: create / update / remove, keeping vehicles in sync; building removal
 * cleanup; auto-connect (road/rail/water/air) and route suggestions for the advisor/AI.
 */
import type { ActionResult, RouteSpec, RouteSuggestion } from '../core/services';
import type { GameContext } from '../core/context';
import { createRouteRecord } from '../core/entities';
import { notify } from '../core/notify';
import type { Building, BuildingId, CompanyId, ProductId, Route, RouteId, RouteOrder, RouteStop, TransportMode } from '../core/types';
import { dist } from '../core/util';
import {
  acceptSlot,
  accessTiles,
  buildingName,
  catchment,
  centerTile,
  producedProducts,
  ringTiles,
  stationModeOf,
  stationsServing,
  supportsMode,
} from './access';
import { DRONE_RANGE, MODE_NAMES, ROUTE_COLORS } from './constants';
import { bestLevel, buildNetwork, estimatePath, planBetween, checkTile } from './network';
import { findBuildingPath } from './pathfinding';
import { invalidatePaths } from './runtime';
import { buyVehicle, pickVehicleType } from './vehicles';

export const loadOrder = (products: ProductId[] | 'all' = 'all', limit = 0): RouteOrder => ({ action: 'load', products, limit });
export const unloadOrder = (products: ProductId[] | 'all' = 'all', limit = 0): RouteOrder => ({ action: 'unload', products, limit });

/** Stop with default orders (first = load, last = unload, middle = both). */
export function defaultStops(buildingIds: BuildingId[]): RouteStop[] {
  return buildingIds.map((id, k) => {
    const first = k === 0;
    const last = k === buildingIds.length - 1;
    const orders: RouteOrder[] = first ? [loadOrder()] : last ? [unloadOrder()] : [unloadOrder(), loadOrder()];
    return { buildingId: id, orders, waitFull: false, minLoad: 0 };
  });
}

function validateStops(ctx: GameContext, companyId: CompanyId, mode: TransportMode, stops: RouteStop[]): string | null {
  if (stops.length < 2) return 'Trasa wymaga co najmniej 2 przystanków';
  for (let k = 0; k < stops.length; k++) {
    const s = stops[k]!;
    const b = ctx.state.buildings[s.buildingId];
    if (!b) return 'Nieznany budynek na trasie';
    const def = ctx.data.buildings[b.typeId];
    if (!supportsMode(def, mode)) return `${buildingName(ctx, b)}: brak obsługi transportu ${MODE_NAMES[mode]}`;
    if (b.owner !== companyId && s.orders.some((o) => o.action === 'load')) return `${buildingName(ctx, b)}: nie można ładować z cudzego budynku`;
    if (b.owner !== companyId && b.owner !== 0 && s.orders.every((o) => o.action !== 'unload')) return `${buildingName(ctx, b)}: cudzy budynek`;
    if (stops.length === 2 && k === 1 && s.buildingId === stops[0]!.buildingId) return 'Przystanki muszą być różne';
  }
  if (mode === 'air') {
    for (let k = 0; k < stops.length; k++) {
      const a = ctx.state.buildings[stops[k]!.buildingId]!;
      const b = ctx.state.buildings[stops[(k + 1) % stops.length]!.buildingId]!;
      const range = ctx.data.buildings[a.typeId]?.radius ?? DRONE_RANGE;
      if (dist(a.x, a.y, b.x, b.y) > Math.max(range, DRONE_RANGE)) return 'Za daleko dla dronów';
    }
  }
  return null;
}

function cloneStops(stops: RouteStop[]): RouteStop[] {
  return stops.map((s) => ({
    buildingId: s.buildingId,
    orders: s.orders.map((o) => ({ action: o.action, products: o.products === 'all' ? 'all' : [...o.products], limit: o.limit ?? 0 })),
    waitFull: !!s.waitFull,
    minLoad: s.minLoad ?? 0,
  }));
}

/** Find a leg of the route that is not connected (index of its first stop) or -1. */
export function firstBrokenLeg(ctx: GameContext, route: Pick<Route, 'mode' | 'stops'>): number {
  for (let k = 0; k < route.stops.length; k++) {
    const a = ctx.state.buildings[route.stops[k]!.buildingId];
    const b = ctx.state.buildings[route.stops[(k + 1) % route.stops.length]!.buildingId];
    if (!a || !b) return k;
    if (a.id === b.id) continue;
    if (!findBuildingPath(ctx, route.mode, a, b)) return k;
  }
  return -1;
}

export function createRoute(ctx: GameContext, companyId: CompanyId, spec: RouteSpec, auto = false): ActionResult<{ id: RouteId; warning?: string }> {
  const state = ctx.state;
  if (!state.companies[companyId]) return { ok: false, reason: 'Nieznana firma' };
  const stops = cloneStops(spec.stops);
  const err = validateStops(ctx, companyId, spec.mode, stops);
  if (err) return { ok: false, reason: err };
  const first = state.buildings[stops[0]!.buildingId]!;
  const last = state.buildings[stops[stops.length - 1]!.buildingId]!;
  const r = createRouteRecord(state, companyId, spec.mode, spec.name ?? `${buildingName(ctx, first)} → ${buildingName(ctx, last)}`);
  r.color = spec.color ?? ROUTE_COLORS[(r.id - 1) % ROUTE_COLORS.length]!;
  r.stops = stops;
  r.priority = Math.min(5, Math.max(1, Math.round(spec.priority ?? 3)));
  r.auto = auto;
  state.routes[r.id] = r;
  ctx.bus.emit('route:created', { routeId: r.id });
  const broken = firstBrokenLeg(ctx, r);
  let warning: string | undefined;
  if (broken >= 0) {
    const a = state.buildings[r.stops[broken]!.buildingId];
    const b = state.buildings[r.stops[(broken + 1) % r.stops.length]!.buildingId];
    warning = `Brak połączenia: ${a ? buildingName(ctx, a) : '?'} → ${b ? buildingName(ctx, b) : '?'}`;
  }
  return warning ? { ok: true, cost: 0, id: r.id, warning } : { ok: true, cost: 0, id: r.id };
}

export function updateRoute(ctx: GameContext, routeId: RouteId, spec: Partial<RouteSpec> & { enabled?: boolean }): boolean {
  const state = ctx.state;
  const r = state.routes[routeId];
  if (!r) return false;
  if (spec.mode && spec.mode !== r.mode) {
    if (r.vehicleIds.length) return false; // vehicles are mode-specific
    r.mode = spec.mode;
  }
  if (spec.stops) {
    const stops = cloneStops(spec.stops);
    if (validateStops(ctx, r.owner, r.mode, stops)) return false;
    r.stops = stops;
    for (const vid of r.vehicleIds) {
      const v = state.vehicles[vid];
      if (!v) continue;
      if (v.stopIndex >= stops.length) v.stopIndex = 0;
      if (v.status === 'moving' || v.status === 'noPath') {
        v.path = [];
        v.pathIndex = 0;
        v.pathProgress = 0;
        v.status = 'moving';
      }
    }
  }
  if (spec.name !== undefined) r.name = spec.name;
  if (spec.color !== undefined) r.color = spec.color;
  if (spec.priority !== undefined) r.priority = Math.min(5, Math.max(1, Math.round(spec.priority)));
  if (spec.enabled !== undefined) r.enabled = spec.enabled;
  ctx.bus.emit('route:changed', { routeId });
  return true;
}

export function removeRoute(ctx: GameContext, routeId: RouteId): boolean {
  const state = ctx.state;
  const r = state.routes[routeId];
  if (!r) return false;
  for (const vid of r.vehicleIds) {
    const v = state.vehicles[vid];
    if (!v) continue;
    v.routeId = null;
    v.status = 'idle';
    v.path = [];
    v.pathIndex = 0;
    v.pathProgress = 0;
  }
  delete state.routes[routeId];
  ctx.bus.emit('route:removed', { routeId });
  return true;
}

/** Remove stops pointing to a removed building; fix vehicles. */
export function onBuildingRemoved(ctx: GameContext, buildingId: BuildingId): void {
  const state = ctx.state;
  invalidatePaths(ctx);
  for (const r of Object.values(state.routes)) {
    if (!r.stops.some((s) => s.buildingId === buildingId)) continue;
    r.stops = r.stops.filter((s) => s.buildingId !== buildingId);
    for (const vid of r.vehicleIds) {
      const v = state.vehicles[vid];
      if (!v) continue;
      if (v.stopIndex >= r.stops.length) v.stopIndex = 0;
      v.path = [];
      v.pathIndex = 0;
      v.pathProgress = 0;
      v.status = r.stops.length ? 'moving' : 'idle';
    }
    if (r.stops.length < 2) {
      r.enabled = false;
      notify(ctx, {
        level: 'warning',
        icon: '🛑',
        title: 'Trasa wstrzymana',
        text: `Trasa „${r.name}” straciła przystanek i ma mniej niż 2 przystanki.`,
        target: { kind: 'route', id: r.id },
        companyId: r.owner,
        category: 'logistics',
      });
    }
    ctx.bus.emit('route:changed', { routeId: r.id });
  }
  for (const b of Object.values(state.buildings)) {
    if (b.hub && b.hub.linked.includes(buildingId)) b.hub.linked = b.hub.linked.filter((id) => id !== buildingId);
  }
}

// ============================================================================
// Connectivity helpers
// ============================================================================

export function isConnected(ctx: GameContext, mode: TransportMode, fromId: BuildingId, toId: BuildingId): boolean {
  const a = ctx.state.buildings[fromId];
  const b = ctx.state.buildings[toId];
  if (!a || !b) return false;
  if (mode === 'air') {
    if (!supportsMode(ctx.data.buildings[a.typeId], 'air') || !supportsMode(ctx.data.buildings[b.typeId], 'air')) return false;
    return dist(a.x, a.y, b.x, b.y) <= DRONE_RANGE;
  }
  return !!findBuildingPath(ctx, mode, a, b);
}

/** Free tiles next to a building usable as a road/rail start (existing network or buildable). */
function endpointTiles(ctx: GameContext, companyId: CompanyId, kind: 'road' | 'rail', b: Building): number[] {
  return ringTiles(ctx.state, b).filter((i) => checkTile(ctx, companyId, kind, 1, i).ok && !checkTile(ctx, companyId, kind, 1, i).bridge);
}

/** Plan (and optionally build) a road/rail between two buildings. */
export function connectBuildings(
  ctx: GameContext,
  companyId: CompanyId,
  kind: 'road' | 'rail',
  a: Building,
  b: Building,
  build: boolean,
): ActionResult<{ tiles: number[] }> {
  const mode = kind;
  if (findBuildingPath(ctx, mode, a, b)) return { ok: true, cost: 0, tiles: [] };
  const src = endpointTiles(ctx, companyId, kind, a);
  const dst = endpointTiles(ctx, companyId, kind, b);
  if (!src.length || !dst.length) return { ok: false, reason: `Brak miejsca na ${kind === 'road' ? 'drogę' : 'tory'} przy budynku` };
  const path = planBetween(ctx, kind, src, dst, companyId);
  if (!path) return { ok: false, reason: `Nie znaleziono trasy dla ${kind === 'road' ? 'drogi' : 'torów'}` };
  const level = bestLevel(ctx, kind);
  const est = estimatePath(ctx, companyId, kind, path, level);
  if (!est.ok) return { ok: false, reason: est.reason === 'Brak środków' ? `Brak środków (${Math.round(est.cost)} zł)` : (est.reason ?? 'Nie można budować') };
  if (!build) return { ok: true, cost: est.cost, tiles: path };
  const res = buildNetwork(ctx, companyId, kind, path, level);
  if (!res.ok) return res;
  return { ok: true, cost: res.cost, tiles: path };
}

/** Products that `from` can supply and `to` accepts (for auto orders). */
export function tradableProducts(ctx: GameContext, from: Building, to: Building): ProductId[] {
  const out: ProductId[] = [];
  const targets = [to, ...(stationModeOf(ctx.data.buildings[to.typeId]) ? catchment(ctx, to) : [])];
  const sources = [from, ...(stationModeOf(ctx.data.buildings[from.typeId]) ? catchment(ctx, from) : [])];
  const seen = new Set<ProductId>();
  for (const s of sources)
    for (const p of producedProducts(ctx, s)) {
      if (seen.has(p)) continue;
      seen.add(p);
      if (targets.some((t) => acceptSlot(ctx, t, p, true))) out.push(p);
    }
  return out;
}


// ============================================================================
// Auto-connect
// ============================================================================

export function autoConnect(
  ctx: GameContext,
  companyId: CompanyId,
  fromId: BuildingId,
  toId: BuildingId,
  mode: TransportMode,
): ActionResult<{ routeId: RouteId; vehicleId?: number; warning?: string }> {
  const state = ctx.state;
  let a = state.buildings[fromId];
  let b = state.buildings[toId];
  const company = state.companies[companyId];
  if (!a || !b) return { ok: false, reason: 'Nieznany budynek' };
  if (!company) return { ok: false, reason: 'Nieznana firma' };
  if (a.owner !== companyId) return { ok: false, reason: 'Budynek źródłowy należy do innej firmy' };
  if (a.id === b.id) return { ok: false, reason: 'Wybierz dwa różne budynki' };
  const products = tradableProducts(ctx, a, b);
  let spent = 0;

  // Non-road modes: use stations serving the buildings when they are not stations themselves.
  if (mode !== 'road') {
    if (!supportsMode(ctx.data.buildings[a.typeId], mode)) {
      const s = stationsServing(ctx, a, mode)[0];
      if (!s) return { ok: false, reason: `Brak stacji (${MODE_NAMES[mode]}) obsługującej: ${buildingName(ctx, a)}` };
      a = s;
    }
    if (!supportsMode(ctx.data.buildings[b.typeId], mode)) {
      const cand = Object.values(state.buildings).filter(
        (s) => s.owner === companyId && stationModeOf(ctx.data.buildings[s.typeId]) === mode && catchment(ctx, s).some((c) => c.id === b!.id),
      );
      const s = cand[0];
      if (!s) return { ok: false, reason: `Brak stacji (${MODE_NAMES[mode]}) obsługującej: ${buildingName(ctx, b)}` };
      b = s;
    }
  }

  if (mode === 'road' || mode === 'rail') {
    const res = connectBuildings(ctx, companyId, mode, a, b, true);
    if (!res.ok) return res;
    spent += res.cost;
  } else if (mode === 'water') {
    if (!accessTiles(ctx, a, 'water').length || !accessTiles(ctx, b, 'water').length) return { ok: false, reason: 'Port bez dostępu do wody' };
    if (!findBuildingPath(ctx, 'water', a, b)) return { ok: false, reason: 'Brak połączenia wodnego między portami' };
  } else if (!isConnected(ctx, 'air', a.id, b.id)) return { ok: false, reason: 'Za daleko dla dronów' };

  // reuse an existing route with the same endpoints
  let route = Object.values(state.routes).find(
    (r) => r.owner === companyId && r.mode === mode && r.stops.length === 2 && r.stops[0]!.buildingId === a!.id && r.stops[1]!.buildingId === b!.id,
  );
  if (!route) {
    const loadP: ProductId[] | 'all' = products.length ? products : 'all';
    // "Ruda żelaza: Kopalnia rudy → Huta stali" (stations are named after cities, see economy build)
    const pname = products.length === 1 ? (ctx.data.products[products[0]!]?.name ?? products[0]) : null;
    const ends = `${buildingName(ctx, a)} → ${buildingName(ctx, b)}`;
    const spec: RouteSpec = {
      name: pname ? `${pname}: ${ends}` : ends,
      mode,
      stops: [
        { buildingId: a.id, orders: [loadOrder(loadP)], waitFull: false, minLoad: 0 },
        { buildingId: b.id, orders: [unloadOrder('all')], waitFull: false, minLoad: 0 },
      ],
    };
    const cr = createRoute(ctx, companyId, spec, true);
    if (!cr.ok) return cr;
    route = state.routes[cr.id]!;
  }
  const typeId = pickVehicleType(ctx, companyId, mode, undefined, products);
  if (!typeId) return { ok: true, cost: spent, routeId: route.id, warning: 'Brak środków lub dostępnego pojazdu — trasa bez pojazdu' };
  const bv = buyVehicle(ctx, companyId, typeId, route.id, { depotId: a.id });
  if (!bv.ok) return { ok: true, cost: spent, routeId: route.id, warning: bv.reason };
  return { ok: true, cost: spent + bv.cost, routeId: route.id, vehicleId: bv.id };
}

// ============================================================================
// Suggestions (advisor / AI)
// ============================================================================

export function suggestRoutes(ctx: GameContext, companyId: CompanyId, limit = 5): RouteSuggestion[] {
  const state = ctx.state;
  const own = Object.values(state.buildings).filter((b) => b.owner === companyId);
  const served = new Set<string>();
  for (const r of Object.values(state.routes)) {
    if (r.owner !== companyId) continue;
    for (let i = 0; i < r.stops.length; i++)
      for (let j = 0; j < r.stops.length; j++) if (i !== j) served.add(`${r.stops[i]!.buildingId}>${r.stops[j]!.buildingId}`);
  }
  const out: RouteSuggestion[] = [];
  for (const a of own) {
    const produced = producedProducts(ctx, a);
    if (!produced.length) continue;
    for (const p of produced) {
      let best: Building | null = null;
      let bestD = Infinity;
      for (const b of own) {
        if (b.id === a.id || served.has(`${a.id}>${b.id}`)) continue;
        if (!acceptSlot(ctx, b, p, true)) continue;
        const d = dist(a.x + a.w / 2, a.y + a.h / 2, b.x + b.w / 2, b.y + b.h / 2);
        // prefer consumers (input) over hubs
        const score = d * (acceptSlot(ctx, b, p, true) === 'storage' ? 1.5 : 1);
        if (score < bestD) {
          bestD = score;
          best = b;
        }
      }
      if (!best) continue;
      const stock = (a.output[p]?.qty ?? 0) + (a.storage[p]?.qty ?? 0);
      out.push({
        fromBuilding: a.id,
        toBuilding: best.id,
        productId: p,
        distance: Math.round(dist(a.x, a.y, best.x, best.y)),
        connected: false,
        score: stock + 100 / (1 + bestD),
      });
    }
  }
  out.sort((x, y) => y.score - x.score);
  const top = out.slice(0, limit);
  for (const s of top) s.connected = isConnected(ctx, 'road', s.fromBuilding, s.toBuilding);
  return top;
}

export { centerTile };
