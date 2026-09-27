/**
 * Headless test harness for economy tests (no world/logistics modules needed):
 * flat fertile map, one city with demand, and a tiny "logistics" stub that
 * moves goods between buildings every day.
 */
import { createContext, type GameContext } from '../core/context';
import { DAYS_PER_MONTH } from '../core/constants';
import { createCityRecord } from '../core/entities';
import { installCore, startNewGame } from '../core/lifecycle';
import { addMoney } from '../core/money';
import { SystemOrder } from '../core/sim';
import { Terrain, type BuildingId, type City, type GameState, type NewGameOptions } from '../core/types';
import { moveStock, stockQty } from '../core/util';
import { init as initEconomy } from './index';

export interface Harness {
  ctx: GameContext;
  state: GameState;
  city: City;
}

/** Refresh city demand like the world module does (consumption × population × seasonal). */
export function refreshDemand(ctx: GameContext, state: GameState, city: City): void {
  const eraIdx = ctx.data.eraIndex(state.time.eraId);
  for (const p of ctx.data.productList()) {
    if (!p.consumption || ctx.data.eraIndex(p.era) > eraIdx) continue;
    const c = p.consumption;
    const base = ((c.poor ?? 0) * city.population.poor + (c.middle ?? 0) * city.population.middle + (c.rich ?? 0) * city.population.rich) / 1000;
    const monthly = base * (p.seasonal?.[state.time.month - 1] ?? 1);
    const d = (city.demand[p.id] ??= { monthly: 0, suppliedMonth: 0, satisfaction: 0, price: 0, shareByCompany: {}, history: [] });
    d.monthly = monthly;
    d.price = state.market.products[p.id]?.price ?? p.basePrice;
  }
}

export function createHarness(opts: Partial<NewGameOptions> & { population?: number } = {}): Harness {
  const ctx = createContext({ headless: true });
  ctx.sim.throwOnError = true;
  installCore(ctx);
  initEconomy(ctx);
  // flat, fertile, forested-at-the-edge test map
  ctx.newGame.register('mapgen', 100, (state) => {
    const m = state.map;
    m.terrain.fill(Terrain.Grass);
    m.fertility.fill(180);
    m.forest.fill(0);
    m.depositTypes = ['', 'coal', 'iron'];
  });
  // world stub: one city, monthly demand refresh + accumulator reset (world 'cities' system semantics)
  ctx.newGame.register('cities', 200, (state) => {
    const pop = opts.population ?? 5000;
    const c = createCityRecord(state, 'Testowo', 20, 20, pop);
    c.radius = 3;
    c.labour.workforce = Math.round(pop * 0.5);
    c.labour.wage = 55;
    state.cities[c.id] = c;
    refreshDemand(ctx, state, c);
  });
  ctx.sim.registerSystem(
    'cities',
    SystemOrder.cities,
    (state) => {
      for (const c of Object.values(state.cities)) {
        for (const d of Object.values(c.demand)) {
          d.satisfaction = d.monthly > 0 ? Math.min(1, d.suppliedMonth / d.monthly) : 1;
          d.suppliedMonth = 0;
          d.shareByCompany = {};
        }
        refreshDemand(ctx, state, c);
      }
    },
    { period: 'month' },
  );
  const state = startNewGame(ctx, { seed: 42, mapWidth: 64, mapHeight: 64, rivals: 0, ...opts });
  const city = Object.values(state.cities)[0]!;
  return { ctx, state, city };
}

export interface Link {
  from: BuildingId;
  to: BuildingId;
  /** Units per day this link can move (≈ vehicles × capacity / round trip days). */
  perDay: number;
}

/**
 * Logistics stub: every day move goods along links (output → input, respecting
 * capacity), charge vehicle upkeep per link. Returns an unregister function.
 */
export function addTransport(h: Harness, links: Link[], upkeepPerLinkMonth = 80): void {
  const { ctx } = h;
  ctx.sim.registerSystem(
    'test.transport',
    SystemOrder.logistics,
    (state) => {
      for (const l of links) {
        const a = state.buildings[l.from];
        const b = state.buildings[l.to];
        if (!a || !b || b.constructionProgress < 1) continue;
        const def = ctx.data.building(b.typeId);
        const accepts = def.category === 'shop' ? (def.sells ?? []) : b.recipeId ? ctx.data.recipe(b.recipeId).inputs.map((i) => i.product) : [];
        let budget = l.perDay;
        for (const p of Object.keys(a.output)) {
          if (!accepts.includes(p) || budget <= 0) continue;
          const room = def.capacity - stockQty(b.input, p);
          budget -= moveStock(a.output, b.input, p, Math.min(budget, room));
        }
      }
      const owner = state.playerCompanyId;
      addMoney(ctx, owner, -(links.length * upkeepPerLinkMonth) / DAYS_PER_MONTH, 'vehicleUpkeep');
    },
    { period: 'day' },
  );
}

/** Find all numbers in an object tree that are not finite (path list). */
export function findNaN(v: unknown, path = 'state', out: string[] = [], depth = 0): string[] {
  if (depth > 8 || out.length > 20) return out;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) out.push(path);
  } else if (Array.isArray(v)) v.forEach((x, i) => findNaN(x, `${path}[${i}]`, out, depth + 1));
  else if (v && typeof v === 'object' && !ArrayBuffer.isView(v)) for (const [k, x] of Object.entries(v)) findNaN(x, `${path}.${k}`, out, depth + 1);
  return out;
}
