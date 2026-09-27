import { describe, expect, it } from 'vitest';
import { deserializeState, serializeState } from '../core/save';
import { addStock, stockQty, stockTotal } from '../core/util';
import { loadOrder, unloadOrder } from './routes';
import { createTestWorld } from './testkit';

describe('vehicles & routes', () => {
  it('a cart delivers grain from farm to mill in a headless sim', () => {
    const w = createTestWorld();
    const { ctx, state, player } = w;
    const farm = w.place('t_farm', 4, 4);
    const mill = w.place('t_mill', 24, 4);
    ctx.services.logistics.buildNetwork(player, 'road', w.line(6, 4, 23, 4), 1);
    addStock(farm.output, 't_grain', 60, 0.7);
    const r = ctx.services.logistics.createRoute(player, {
      mode: 'road',
      stops: [
        { buildingId: farm.id, orders: [loadOrder('all')], waitFull: false, minLoad: 0 },
        { buildingId: mill.id, orders: [unloadOrder('all')], waitFull: false, minLoad: 0 },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r as { warning?: string }).warning).toBeUndefined();
    const cash0 = state.companies[player]!.cash;
    const bv = ctx.services.logistics.buyVehicle(player, 't_cart', r.id);
    expect(bv.ok).toBe(true);
    if (!bv.ok) return;
    expect(state.companies[player]!.cash).toBe(cash0 - 1000);
    const delivered: number[] = [];
    ctx.bus.on('vehicle:delivered', (e) => delivered.push(e.qty));
    ctx.sim.advanceDays(20);
    const v = state.vehicles[bv.id]!;
    expect(delivered.length).toBeGreaterThan(0);
    expect(stockQty(mill.input, 't_grain')).toBeGreaterThan(0);
    expect(mill.input['t_grain']!.quality).toBeCloseTo(0.7, 5);
    expect(v.stats.deliveredMonth).toBeGreaterThan(0);
    expect(v.stats.revenueMonth).toBeGreaterThan(0);
    expect(state.routes[r.id]!.stats.tripsMonth).toBeGreaterThan(0);
    // goods conserved
    expect(stockQty(farm.output, 't_grain') + stockTotal(v.cargo) + stockQty(mill.input, 't_grain')).toBeCloseTo(60, 5);
    // running costs charged
    expect(state.companies[player]!.finances.current.ledger.vehicleUpkeep ?? 0).toBeLessThan(0);
    // traffic recorded
    expect(v.stats.distanceMonth).toBeGreaterThan(0);
    let traffic = 0;
    for (const t of w.line(6, 4, 23, 4)) traffic += state.network.traffic[t]!;
    expect(traffic).toBeGreaterThan(0);
  });

  it('only loads products that a later stop accepts, waits for full load', () => {
    const w = createTestWorld();
    const { ctx, state, player } = w;
    const wh = w.place('t_wh', 4, 4);
    const mill = w.place('t_mill', 14, 4);
    ctx.services.logistics.buildNetwork(player, 'road', w.line(6, 4, 13, 4), 1);
    addStock(wh.storage, 't_grain', 5, 0.5);
    addStock(wh.storage, 't_bread', 50, 0.5); // mill does not accept bread
    const r = ctx.services.logistics.createRoute(player, {
      mode: 'road',
      stops: [
        { buildingId: wh.id, orders: [loadOrder('all')], waitFull: true, minLoad: 1 },
        { buildingId: mill.id, orders: [unloadOrder('all')], waitFull: false, minLoad: 0 },
      ],
    });
    if (!r.ok) throw new Error(r.reason);
    const bv = ctx.services.logistics.buyVehicle(player, 't_cart', r.id);
    if (!bv.ok) throw new Error(bv.reason);
    ctx.sim.advanceDays(3);
    const v = state.vehicles[bv.id]!;
    expect(v.status).toBe('waiting');
    expect(stockQty(v.cargo, 't_bread')).toBe(0);
    expect(stockQty(v.cargo, 't_grain')).toBeCloseTo(5);
    addStock(wh.storage, 't_grain', 20, 0.5);
    ctx.sim.advanceDays(10);
    expect(stockQty(mill.input, 't_grain')).toBeGreaterThanOrEqual(10);
    expect(stockQty(wh.storage, 't_bread')).toBe(50);
  });

  it('intermodal: truck → rail station → train → station catchment → mill', () => {
    const w = createTestWorld(64);
    const { ctx, state, player } = w;
    const farm = w.place('t_farm', 2, 10);
    const stA = w.place('t_station', 10, 10); // 10..11 x 10
    const stB = w.place('t_station', 40, 10); // 40..41
    const mill = w.place('t_mill', 43, 11); // within catchment of stB (radius 3)
    // road farm → station A
    ctx.services.logistics.buildNetwork(player, 'road', w.line(4, 10, 9, 10), 1);
    // rail between stations (below them)
    ctx.services.logistics.buildNetwork(player, 'rail', w.line(10, 11, 41, 11), 1);
    addStock(farm.output, 't_grain', 40, 0.5);
    const truckRoute = ctx.services.logistics.createRoute(player, {
      mode: 'road',
      stops: [
        { buildingId: farm.id, orders: [loadOrder('all')], waitFull: false, minLoad: 0 },
        { buildingId: stA.id, orders: [unloadOrder('all')], waitFull: false, minLoad: 0 },
      ],
    });
    if (!truckRoute.ok) throw new Error(truckRoute.reason);
    const trainRoute = ctx.services.logistics.createRoute(player, {
      mode: 'rail',
      stops: [
        { buildingId: stA.id, orders: [loadOrder('all')], waitFull: false, minLoad: 0 },
        { buildingId: stB.id, orders: [unloadOrder('all')], waitFull: false, minLoad: 0 },
      ],
    });
    if (!trainRoute.ok) throw new Error(trainRoute.reason);
    expect((trainRoute as { warning?: string }).warning).toBeUndefined();
    expect(ctx.services.logistics.buyVehicle(player, 't_cart', truckRoute.id).ok).toBe(true);
    const train = ctx.services.logistics.buyVehicle(player, 't_train', trainRoute.id, { wagons: 2 });
    expect(train.ok).toBe(true);
    if (!train.ok) return;
    expect(state.vehicles[train.id]!.capacity).toBe(40);
    ctx.sim.advanceDays(40);
    expect(stockQty(mill.input, 't_grain')).toBeGreaterThan(0);
  });

  it('autoConnect builds a road, a route and buys a vehicle', () => {
    const w = createTestWorld();
    const { ctx, state, player } = w;
    const farm = w.place('t_farm', 4, 4);
    const mill = w.place('t_mill', 20, 12);
    const res = ctx.services.logistics.autoConnect(player, farm.id, mill.id, 'road');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(ctx.services.logistics.isConnected('road', farm.id, mill.id)).toBe(true);
    const route = state.routes[res.routeId]!;
    expect(route.auto).toBe(true);
    expect(route.vehicleIds.length).toBe(1);
    expect(route.stops[0]!.orders[0]!.products).toEqual(['t_grain']);
    addStock(farm.output, 't_grain', 30, 0.5);
    ctx.sim.advanceDays(30);
    expect(stockQty(mill.input, 't_grain')).toBeGreaterThan(0);
    // second call reuses the route and adds a vehicle
    const again = ctx.services.logistics.autoConnect(player, farm.id, mill.id, 'road');
    expect(again.ok && again.routeId).toBe(res.routeId);
    expect(route.vehicleIds.length).toBe(2);
    // suggestions skip served pairs
    const shop = w.place('t_shop', 30, 30);
    void shop;
    const sug = ctx.services.logistics.suggestRoutes(player);
    expect(sug.some((s) => s.fromBuilding === farm.id && s.toBuilding === mill.id)).toBe(false);
  });

  it('sells vehicles with depreciation and handles removed buildings', () => {
    const w = createTestWorld();
    const { ctx, state, player } = w;
    const farm = w.place('t_farm', 4, 4);
    const mill = w.place('t_mill', 14, 4);
    ctx.services.logistics.buildNetwork(player, 'road', w.line(6, 4, 13, 4), 1);
    const r = ctx.services.logistics.createRoute(player, {
      mode: 'road',
      stops: [
        { buildingId: farm.id, orders: [loadOrder()], waitFull: false, minLoad: 0 },
        { buildingId: mill.id, orders: [unloadOrder()], waitFull: false, minLoad: 0 },
      ],
    });
    if (!r.ok) throw new Error(r.reason);
    const a = ctx.services.logistics.buyVehicle(player, 't_cart', r.id);
    const b = ctx.services.logistics.buyVehicle(player, 't_cart', r.id);
    if (!a.ok || !b.ok) throw new Error('buy');
    ctx.sim.advanceDays(5);
    const cash = state.companies[player]!.cash;
    const s = ctx.services.logistics.sellVehicle(a.id);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(-s.cost).toBeGreaterThan(0);
    expect(-s.cost).toBeLessThan(1000);
    expect(state.companies[player]!.cash).toBeCloseTo(cash - s.cost);
    expect(state.routes[r.id]!.vehicleIds).toEqual([b.id]);
    ctx.services.economy.demolish(mill.id);
    expect(state.routes[r.id]!.enabled).toBe(false);
    expect(state.routes[r.id]!.stops.length).toBe(1);
    ctx.sim.advanceDays(2);
    expect(ctx.services.logistics.removeRoute(r.id)).toBe(true);
    expect(state.vehicles[b.id]!.status).toBe('idle');
  });

  it('ships wait during storms and state survives save/load', () => {
    const w = createTestWorld(48, { water: (x, y) => y >= 10 && y <= 20 });
    const { ctx, state, player } = w;
    const h1 = w.place('t_harbor', 4, 8); // rows 8..9, touches water at y=10
    const h2 = w.place('t_harbor', 36, 8);
    addStock(h1.storage, 't_grain', 100, 0.5);
    const r = ctx.services.logistics.createRoute(player, {
      mode: 'water',
      stops: [
        { buildingId: h1.id, orders: [loadOrder()], waitFull: false, minLoad: 0 },
        { buildingId: h2.id, orders: [unloadOrder()], waitFull: false, minLoad: 0 },
      ],
    });
    if (!r.ok) throw new Error(r.reason);
    const ship = ctx.services.logistics.buyVehicle(player, 't_ship', r.id);
    if (!ship.ok) throw new Error(ship.reason);
    ctx.sim.advanceDays(2);
    const v = state.vehicles[ship.id]!;
    expect(v.status).toBe('moving');
    for (const reg of state.weather.regions) reg.kind = 'storm';
    ctx.sim.advanceDays(1);
    expect(v.status).toBe('waiting');
    const x = v.x;
    ctx.sim.advanceDays(3);
    expect(v.x).toBe(x);
    for (const reg of state.weather.regions) reg.kind = 'clear';
    ctx.sim.advanceDays(20);
    expect(stockQty(h2.storage, 't_grain')).toBeGreaterThan(0);
    const copy = deserializeState(serializeState(state));
    expect(copy.vehicles[ship.id]!.path).toEqual(v.path);
    expect(copy.routes[r.id]!.stops).toEqual(state.routes[r.id]!.stops);
  });
});
