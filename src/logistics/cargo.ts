/**
 * Cargo transfer at route stops (load / unload orders).
 *
 * Loading takes from the building's `output` and (for hubs) `storage` above
 * `hub.reserve`. Unloading puts goods into `input` (factories: recipe inputs,
 * shops: products they sell) or `storage` (warehouses / stations / export).
 * Rail/water/air stations extend both to own buildings in their catchment:
 * deliveries go to catchment consumers first (Building.priority desc), the rest
 * into station storage; loads take station storage first, then catchment outputs.
 *
 * Deliveries to buildings of another company are B2B sales (buyer pays market
 * price, 'purchases' / 'trade'); to public (owner 0) buildings they are exports
 * paid at market exportPrice ('export') and the goods leave the game.
 */
import type { GameContext } from '../core/context';
import { addMoney } from '../core/money';
import { recordExport } from '../economy/market';
import type { Building, ProductId, Route, Vehicle } from '../core/types';
import { addStock, stockTotal, takeStock } from '../core/util';
import { acceptSlot, availableProducts, catchment, freeRoom, isCompleted, stationModeOf } from './access';

/** Is the building a station of the route's (non-road) mode? */
function isModeStation(ctx: GameContext, b: Building, route: Route): boolean {
  return route.mode !== 'road' && stationModeOf(ctx.data.buildings[b.typeId]) === route.mode;
}

/** Can the vehicle type carry this product? */
export function canCarry(ctx: GameContext, v: Vehicle, p: ProductId): boolean {
  const def = ctx.data.vehicles[v.typeId];
  const prod = ctx.data.products[p];
  if (!prod) return false;
  return !def?.cargo || def.cargo.includes(prod.weightClass);
}

export function unitPrice(ctx: GameContext, p: ProductId): number {
  try {
    return ctx.services.economy.price(p);
  } catch {
    return ctx.state.market.products[p]?.price ?? ctx.data.products[p]?.basePrice ?? 0;
  }
}

/** Would some other stop of the route take product p? */
export function routeCanUnload(ctx: GameContext, route: Route, fromStop: number, p: ProductId): boolean {
  for (let k = 0; k < route.stops.length; k++) {
    if (k === fromStop && route.stops.length > 1) continue;
    const stop = route.stops[k]!;
    const covers = stop.orders.some((o) => o.action === 'unload' && (o.products === 'all' || o.products.includes(p)));
    if (!covers) continue;
    const b = ctx.state.buildings[stop.buildingId];
    if (!b) continue;
    if (acceptSlot(ctx, b, p)) return true;
    if (isModeStation(ctx, b, route) && catchment(ctx, b).some((c) => acceptSlot(ctx, c, p))) return true;
  }
  return false;
}

// ============================================================================
// Unloading
// ============================================================================

/** Execute unload orders of the current stop. Returns units moved. */
export function unloadAtStop(ctx: GameContext, v: Vehicle, route: Route, stopIndex: number): number {
  const stop = route.stops[stopIndex];
  if (!stop) return 0;
  const b = ctx.state.buildings[stop.buildingId];
  if (!b) return 0;
  let moved = 0;
  for (const order of stop.orders) {
    if (order.action !== 'unload') continue;
    let budget = order.limit > 0 ? order.limit : Infinity;
    const products = order.products === 'all' ? Object.keys(v.cargo) : order.products;
    for (const p of products) {
      const have = v.cargo[p]?.qty ?? 0;
      if (have <= 1e-6 || budget <= 0) continue;
      const n = deliverProduct(ctx, v, route, b, p, Math.min(have, budget));
      budget -= n;
      moved += n;
    }
  }
  return moved;
}

/** Deliver up to qty of p from vehicle cargo to building b (+ catchment). Returns moved units. */
export function deliverProduct(ctx: GameContext, v: Vehicle, route: Route | null, b: Building, p: ProductId, qty: number): number {
  const targets: Building[] = [];
  if (route && isModeStation(ctx, b, route)) {
    const consumers = catchment(ctx, b)
      .filter((c) => acceptSlot(ctx, c, p) === 'input')
      .sort((x, y) => y.priority - x.priority);
    targets.push(...consumers);
  }
  targets.push(b);
  let left = qty;
  for (const t of targets) {
    if (left <= 1e-6) break;
    const slot = acceptSlot(ctx, t, p);
    if (!slot) continue;
    const n = Math.min(left, freeRoom(ctx, t, p, slot));
    if (n <= 1e-6) continue;
    const done = transferTo(ctx, v, route, t, slot, p, n);
    left -= done;
  }
  return qty - left;
}

function transferTo(ctx: GameContext, v: Vehicle, route: Route | null, t: Building, slot: 'input' | 'storage', p: ProductId, n: number): number {
  const state = ctx.state;
  const price = unitPrice(ctx, p);
  let value = n * price;
  if (t.owner !== v.owner) {
    if (t.owner === 0) {
      // public export: goods sold at export price and leave the game
      const ex = state.market.products[p]?.exportPrice ?? price * 0.7;
      value = n * ex;
      takeStock(v.cargo, p, n);
      addMoney(ctx, v.owner, value, 'export');
      recordExport(state, p, n);
    } else {
      const buyer = state.companies[t.owner];
      if (!buyer || buyer.cash < value) return 0;
      const taken = takeStock(v.cargo, p, n);
      addStock(slot === 'storage' ? t.storage : t.input, p, taken.qty, taken.quality);
      addMoney(ctx, t.owner, -value, 'purchases');
      addMoney(ctx, v.owner, value, 'trade');
    }
  } else {
    const taken = takeStock(v.cargo, p, n);
    addStock(slot === 'storage' ? t.storage : t.input, p, taken.qty, taken.quality);
  }
  v.stats.deliveredMonth += n;
  v.stats.totalDelivered += n;
  v.stats.revenueMonth += value;
  if (route) {
    route.stats.deliveredMonth[p] = (route.stats.deliveredMonth[p] ?? 0) + n;
    route.stats.revenueMonth += value;
  }
  ctx.bus.emit('vehicle:delivered', { vehicleId: v.id, buildingId: t.id, productId: p, qty: n, value });
  return n;
}

// ============================================================================
// Loading
// ============================================================================

/** Buildings goods can be loaded from at this stop (own, completed). */
function loadSources(ctx: GameContext, v: Vehicle, route: Route, b: Building): Building[] {
  const out: Building[] = [];
  if (b.owner === v.owner && isCompleted(b)) out.push(b);
  if (isModeStation(ctx, b, route) && b.owner === v.owner) for (const c of catchment(ctx, b)) if (isCompleted(c)) out.push(c);
  return out;
}

function takeFrom(src: Building, p: ProductId, want: number, into: Vehicle['cargo']): number {
  let got = 0;
  const outQ = src.output[p]?.qty ?? 0;
  if (outQ > 1e-6) {
    const t = takeStock(src.output, p, Math.min(outQ, want));
    addStock(into, p, t.qty, t.quality);
    got += t.qty;
  }
  if (got < want && src.hub) {
    const avail = (src.storage[p]?.qty ?? 0) - (src.hub.reserve[p] ?? 0);
    if (avail > 1e-6) {
      const t = takeStock(src.storage, p, Math.min(avail, want - got));
      addStock(into, p, t.qty, t.quality);
      got += t.qty;
    }
  }
  return got;
}

/** Execute load orders of the current stop. Returns units loaded. */
export function loadAtStop(ctx: GameContext, v: Vehicle, route: Route, stopIndex: number): number {
  const stop = route.stops[stopIndex];
  if (!stop) return 0;
  const b = ctx.state.buildings[stop.buildingId];
  if (!b) return 0;
  const sources = loadSources(ctx, v, route, b);
  if (!sources.length) return 0;
  let loaded = 0;
  for (const order of stop.orders) {
    if (order.action !== 'load') continue;
    let room = v.capacity - stockTotal(v.cargo);
    if (room <= 1e-6) break;
    let budget = order.limit > 0 ? order.limit : Infinity;
    let products: ProductId[];
    if (order.products === 'all') {
      const set = new Set<ProductId>();
      for (const s of sources) for (const p of availableProducts(ctx, s)) set.add(p);
      products = [...set].filter((p) => canCarry(ctx, v, p) && routeCanUnload(ctx, route, stopIndex, p));
    } else products = order.products.filter((p) => canCarry(ctx, v, p));
    if (!products.length) continue;
    // two passes: fair share per product, then fill the rest
    for (let pass = 0; pass < 2; pass++) {
      for (const p of products) {
        room = v.capacity - stockTotal(v.cargo);
        if (room <= 1e-6 || budget <= 0) break;
        let want = Math.min(room, budget);
        if (pass === 0) want = Math.min(want, Math.max(1, room / products.length));
        for (const s of sources) {
          if (want <= 1e-6) break;
          const got = takeFrom(s, p, want, v.cargo);
          want -= got;
          budget -= got;
          loaded += got;
        }
      }
    }
  }
  return loaded;
}

/** Fill ratio 0..1 of a vehicle. */
export const loadFraction = (v: Vehicle): number => (v.capacity > 0 ? Math.min(1, stockTotal(v.cargo) / v.capacity) : 0);

// ============================================================================
// Station feeding (daily)
// ============================================================================

/**
 * Rail/water/air stations hand goods waiting in their storage to OWN consumers in
 * their catchment every day (factory inputs, shop stock), highest priority first,
 * up to each consumer's free room and the station's daily loadRate. Without this,
 * whatever arrived while a consumer was full stayed in the station forever (and the
 * full storage then blocked the train). Goods above hub.reserve only.
 */
export function feedStations(ctx: GameContext): void {
  const state = ctx.state;
  for (const id in state.buildings) {
    const st = state.buildings[id]!;
    if (!st.hub || !isCompleted(st)) continue;
    const def = ctx.data.buildings[st.typeId];
    const mode = stationModeOf(def);
    if (!mode || mode === 'road') continue;
    let budget = def?.loadRate ?? 200;
    let consumers: Building[] | null = null;
    for (const p of Object.keys(st.storage)) {
      if (budget <= 1e-6) break;
      const e = st.storage[p]!;
      let avail = e.qty - (st.hub.reserve[p] ?? 0);
      if (avail <= 1e-6) continue;
      consumers ??= catchment(ctx, st)
        .filter((c) => isCompleted(c) && c.owner === st.owner)
        .sort((a, b) => b.priority - a.priority || a.id - b.id);
      for (const c of consumers) {
        if (avail <= 1e-6 || budget <= 1e-6) break;
        if (acceptSlot(ctx, c, p) !== 'input') continue;
        const n = Math.min(avail, budget, freeRoom(ctx, c, p, 'input'));
        if (n <= 1e-6) continue;
        const t = takeStock(st.storage, p, n);
        addStock(c.input, p, t.qty, t.quality);
        avail -= t.qty;
        budget -= t.qty;
      }
    }
  }
}
