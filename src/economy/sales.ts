/**
 * Sales (daily, part of the 'market' system):
 *  - shops sell to cities in reach (distance shop→city edge ≤ def.radius).
 *    Each day a city wants demand.monthly / 30 of every product (world owns
 *    `monthly` and `price`; we add to `suppliedMonth` and `shareByCompany`).
 *    Competing shops split it by attractiveness = quality, price factor,
 *    reputation, distance, green preference and `sales.*` modifiers.
 *  - export centers sell their storage abroad at market.exportPrice.
 *  - digital products (category 'digital') are sold straight from the
 *    producer's output to all cities' demand — no transport.
 */
import type { GameContext } from '../core/context';
import { DAYS_PER_MONTH } from '../core/constants';
import { addMoney } from '../core/money';
import type { Building, City, CityDemand, CompanyId, GameState, ProductId } from '../core/types';
import { clamp, takeStock } from '../core/util';
import type { BuildingDef } from '../data/defs';
import { EXPORT_PRICE_SHARE, WHOLESALE } from './constants';
import { econExt } from './ext';
import { buildingMod, policyAdditive } from './modifiers';
import { setStatus } from './production';

/** Price multiplier for quality (0.5 → 1.0, 1.0 → 1.3, 0 → 0.7). */
export const qualityPriceFactor = (q: number): number => 0.7 + 0.6 * clamp(q, 0, 1);

/** Local selling price per unit before shop price factor / quality. */
export function localPrice(state: GameState, city: City | null, productId: ProductId, basePrice: number): number {
  const d = city?.demand[productId];
  if (d && d.price > 0 && Number.isFinite(d.price)) return d.price;
  return state.market.products[productId]?.price ?? basePrice;
}

/** Distance from a shop center to the city edge. */
function reach(b: Building, c: City): number {
  return Math.max(0, Math.hypot(b.x + b.w / 2 - c.x, b.y + b.h / 2 - c.y) - c.radius);
}

/** Cities served by a shop (in reach), nearest first. */
export function citiesInReach(state: GameState, b: Building, def: BuildingDef): City[] {
  const r = def.radius ?? 8;
  return Object.values(state.cities)
    .filter((c) => reach(b, c) <= r)
    .sort((a, z) => reach(b, a) - reach(b, z) || a.id - z.id);
}

interface ShopRun {
  b: Building;
  def: BuildingDef;
  left: number;
  rep: number;
  salesMod: number;
  pf: number;
  sold: number;
  cities: City[];
}

interface Acc {
  revenue: Map<CompanyId, number>;
  subsidy: Map<CompanyId, number>;
  /** productId → subsidy rate cache for this day. */
  rates: Map<string, number>;
}

/** Subsidy rate (fraction of revenue) for a product today (regulations + world events). */
function subsidyRate(state: GameState, acc: Acc, p: ProductId): number {
  let r = acc.rates.get(p);
  if (r === undefined) {
    r = Math.max(0, policyAdditive(state, `subsidy.${p}`, 'subsidy', p));
    acc.rates.set(p, r);
  }
  return r;
}

function recordSale(ctx: GameContext, acc: Acc, b: Building, city: City | null, d: CityDemand | undefined, p: ProductId, qty: number, revenue: number, quality: number): void {
  const state = ctx.state;
  acc.revenue.set(b.owner, (acc.revenue.get(b.owner) ?? 0) + revenue);
  const sub = subsidyRate(state, acc, p);
  if (sub > 0) acc.subsidy.set(b.owner, (acc.subsidy.get(b.owner) ?? 0) + revenue * sub);
  b.stats.soldMonth[p] = (b.stats.soldMonth[p] ?? 0) + qty;
  b.stats.revenueMonth += revenue;
  b.stats.totalRevenue += revenue;
  const mp = state.market.products[p];
  if (mp) {
    mp.current.sold += qty;
    b.stats.costMonth += qty * mp.price * WHOLESALE;
  }
  if (d) {
    d.suppliedMonth += qty;
    d.shareByCompany[b.owner] = (d.shareByCompany[b.owner] ?? 0) + qty;
  }
  const sq = (econExt(state).salesQ[b.owner] ??= [0, 0]);
  sq[0] += qty;
  sq[1] += qty * quality;
  ctx.bus.emit('sale', { companyId: b.owner, buildingId: b.id, cityId: city?.id ?? 0, productId: p, qty, revenue });
}

// ---------------------------------------------------------------- shops
function runShops(ctx: GameContext, acc: Acc): void {
  const state = ctx.state;
  const runs: ShopRun[] = [];
  const byCity = new Map<number, ShopRun[]>();
  for (const id in state.buildings) {
    const b = state.buildings[id]!;
    const def = ctx.data.buildings[b.typeId];
    if (!def || def.category !== 'shop' || b.constructionProgress < 1) continue;
    if (!b.enabled || b.condition < 0.25) continue;
    if (b.workers.required > 0 && b.workers.employed < b.workers.required * 0.25) {
      setStatus(ctx, b, 'noWorkers');
      continue;
    }
    const company = state.companies[b.owner];
    if (!company || company.bankrupt) continue;
    const cities = citiesInReach(state, b, def);
    let stocked = false;
    for (const p in b.input) if (b.input[p]!.qty > 1e-6) stocked = true;
    if (!cities.length) {
      setStatus(ctx, b, 'noCustomers');
      continue;
    }
    if (!stocked) {
      setStatus(ctx, b, 'noInput');
      continue;
    }
    setStatus(ctx, b, 'ok');
    const salesMod = buildingMod(state, b, def, 'sales');
    const run: ShopRun = {
      b,
      def,
      left: (def.salesPerDay ?? 12) * Math.max(0, b.efficiency) * salesMod,
      rep: company.reputation,
      salesMod,
      pf: clamp(b.shop?.priceFactor ?? 1, 0.5, 2),
      sold: 0,
      cities,
    };
    runs.push(run);
    for (const c of cities) {
      const list = byCity.get(c.id);
      if (list) list.push(run);
      else byCity.set(c.id, [run]);
    }
  }
  const cityIds = [...byCity.keys()].sort((a, z) => a - z);
  for (const cid of cityIds) {
    const city = state.cities[cid]!;
    const shops = byCity.get(cid)!;
    const products = Object.keys(city.demand).sort();
    for (const p of products) {
      const d = city.demand[p]!;
      if (!(d.monthly > 0)) continue;
      const pd = ctx.data.products[p];
      if (!pd) continue;
      const remaining = Math.max(0, d.monthly - d.suppliedMonth);
      let want = Math.min(remaining, (d.monthly / DAYS_PER_MONTH) * 1.25);
      if (want <= 1e-6) continue;
      const green = pd.green ? city.greenPreference : 0;
      // two passes: split by attractiveness, then leftovers
      for (let pass = 0; pass < 2 && want > 1e-6; pass++) {
        const cand: { run: ShopRun; a: number; q: number }[] = [];
        for (const run of shops) {
          if (run.left <= 1e-6) continue;
          const e = run.b.input[p];
          if (!e || e.qty <= 1e-6) continue;
          if (!run.def.sells?.includes(p)) continue;
          if (run.b.shop?.assortment.length && !run.b.shop.assortment.includes(p)) continue;
          const dist = reach(run.b, city);
          const distF = 1 - 0.4 * clamp(dist / Math.max(1, run.def.radius ?? 8), 0, 1);
          const qf = qualityPriceFactor(e.quality);
          const a = (Math.pow(qf, 1.5) / (run.pf * run.pf)) * (0.6 + (0.8 * clamp(run.rep, 0, 100)) / 100) * run.salesMod * distF * (1 + green);
          cand.push({ run, a: Math.max(1e-6, a), q: e.quality });
        }
        if (!cand.length) break;
        const total = cand.reduce((s, c) => s + c.a, 0);
        let sold = 0;
        for (const c of cand) {
          const share = c.a / total;
          const elastic = clamp(Math.pow(c.run.pf, -1.2), 0.2, 1.3);
          const e = c.run.b.input[p]!;
          const qty = Math.min(want * share * (pass === 0 ? elastic : 1), e.qty, c.run.left);
          if (qty <= 1e-6) continue;
          const taken = takeStock(c.run.b.input, p, qty);
          const unit = localPrice(state, city, p, pd.basePrice) * c.run.pf * qualityPriceFactor(taken.quality) * (1 + 0.3 * green);
          const revenue = Math.round(taken.qty * unit * 100) / 100;
          c.run.left -= taken.qty;
          c.run.sold += taken.qty;
          sold += taken.qty;
          recordSale(ctx, acc, c.run.b, city, d, p, taken.qty, revenue, taken.quality);
        }
        want -= sold;
        if (sold <= 1e-6) break;
      }
    }
  }
  // utilization sample for shops
  const ext = econExt(state);
  for (const run of runs) {
    const cap = (run.def.salesPerDay ?? 12) * run.salesMod;
    const u = (ext.util[run.b.id] ??= [0, 0]);
    u[0] += cap > 0 ? clamp(run.sold / cap, 0, 1) : 0;
  }
}

// ---------------------------------------------------------------- export
function runExports(ctx: GameContext, acc: Acc): void {
  const state = ctx.state;
  const ext = econExt(state);
  for (const id in state.buildings) {
    const b = state.buildings[id]!;
    const def = ctx.data.buildings[b.typeId];
    if (!def || def.category !== 'export' || b.constructionProgress < 1 || !b.enabled) continue;
    if (b.status !== 'ok') continue;
    const company = state.companies[b.owner];
    if (b.owner && (!company || company.bankrupt)) continue;
    let left = (def.salesPerDay ?? 40) * Math.max(0, b.efficiency) * buildingMod(state, b, def, 'sales');
    let sold = 0;
    for (const p of Object.keys(b.storage).sort()) {
      if (left <= 1e-6) break;
      const e = b.storage[p]!;
      const keep = b.hub?.reserve[p] ?? 0;
      const qty = Math.min(left, e.qty - keep);
      if (qty <= 1e-6) continue;
      const mp = state.market.products[p];
      const pd = ctx.data.products[p];
      const unit = (mp?.exportPrice ?? (pd?.basePrice ?? 0) * EXPORT_PRICE_SHARE) * qualityPriceFactor(e.quality);
      const taken = takeStock(b.storage, p, qty);
      left -= taken.qty;
      sold += taken.qty;
      const revenue = Math.round(taken.qty * unit * 100) / 100;
      ext.exportMonth[p] = (ext.exportMonth[p] ?? 0) + taken.qty;
      if (b.owner) {
        addMoney(ctx, b.owner, revenue, 'export');
        const sub = subsidyRate(state, acc, p);
        if (sub > 0) acc.subsidy.set(b.owner, (acc.subsidy.get(b.owner) ?? 0) + revenue * sub);
        b.stats.soldMonth[p] = (b.stats.soldMonth[p] ?? 0) + taken.qty;
        b.stats.revenueMonth += revenue;
        b.stats.totalRevenue += revenue;
        if (mp) b.stats.costMonth += taken.qty * mp.price * WHOLESALE;
      }
      if (mp) mp.current.sold += taken.qty;
    }
    const u = (ext.util[b.id] ??= [0, 0]);
    const cap = (def.salesPerDay ?? 40) * buildingMod(state, b, def, 'sales');
    u[0] += cap > 0 ? clamp(sold / cap, 0, 1) : 0;
  }
}

// ---------------------------------------------------------------- digital
function runDigital(ctx: GameContext, acc: Acc): void {
  const state = ctx.state;
  const digital = ctx.data.productList().filter((p) => p.category === 'digital');
  if (!digital.length) return;
  const cities = Object.values(state.cities).sort((a, z) => a.id - z.id);
  for (const pd of digital) {
    const sellers: Building[] = [];
    let stock = 0;
    for (const id in state.buildings) {
      const b = state.buildings[id]!;
      const e = b.output[pd.id];
      if (!e || e.qty <= 1e-6) continue;
      const c = state.companies[b.owner];
      if (!c || c.bankrupt) continue;
      sellers.push(b);
      stock += e.qty;
    }
    if (!sellers.length) continue;
    const demands: { city: City; d: CityDemand; want: number }[] = [];
    let want = 0;
    for (const city of cities) {
      const d = city.demand[pd.id];
      if (!d || !(d.monthly > 0)) continue;
      const w = Math.min(Math.max(0, d.monthly - d.suppliedMonth), (d.monthly / DAYS_PER_MONTH) * 1.25);
      if (w <= 0) continue;
      demands.push({ city, d, want: w });
      want += w;
    }
    if (want <= 1e-6) continue;
    const ratio = Math.min(1, stock / want);
    for (const b of sellers) {
      const e = b.output[pd.id]!;
      const share = e.qty / stock;
      for (const dm of demands) {
        const qty = Math.min(dm.want * ratio * share, b.output[pd.id]?.qty ?? 0);
        if (qty <= 1e-6) continue;
        const taken = takeStock(b.output, pd.id, qty);
        const unit = localPrice(state, dm.city, pd.id, pd.basePrice) * qualityPriceFactor(taken.quality);
        recordSale(ctx, acc, b, dm.city, dm.d, pd.id, taken.qty, Math.round(taken.qty * unit * 100) / 100, taken.quality);
      }
    }
  }
}

/** Daily sales system. */
export function salesSystem(state: GameState, _dt: number, ctx: GameContext): void {
  const acc: Acc = { revenue: new Map(), subsidy: new Map(), rates: new Map() };
  runShops(ctx, acc);
  runExports(ctx, acc);
  runDigital(ctx, acc);
  for (const [owner, rev] of [...acc.revenue.entries()].sort((a, z) => a[0] - z[0]))
    if (rev > 0) addMoney(ctx, owner, Math.round(rev * 100) / 100, 'sales');
  for (const [owner, sub] of [...acc.subsidy.entries()].sort((a, z) => a[0] - z[0]))
    if (sub > 0) addMoney(ctx, owner, Math.round(sub * 100) / 100, 'subsidy');
}
