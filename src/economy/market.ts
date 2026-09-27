/**
 * Market prices. One global reference price per product:
 *
 *   price → base × priceIndex × economyFactor × seasonal × scarcity × events("price.<id>|<category>|all")
 *   scarcity = clamp(PRICE_A − PRICE_B × supply/demand, PRICE_MIN, PRICE_MAX)
 *
 * supply = units produced last month (all companies), demand = city demand
 * (sum of city.demand[p].monthly) + units consumed by factories. Prices move
 * PRICE_SMOOTHING of the way toward the target each month.
 * exportPrice = price × EXPORT_PRICE_SHARE, lowered by last month's export volume.
 */
import type { GameContext } from '../core/context';
import type { GameState, MarketProduct } from '../core/types';
import { clamp, pushHistory } from '../core/util';
import type { ProductDef } from '../data/defs';
import {
  EXPORT_PRICE_SHARE,
  EXPORT_SATURATION_UNITS,
  INTEREST_RATE,
  PRICE_A,
  PRICE_B,
  PRICE_MAX,
  PRICE_MIN,
  PRICE_INDEX_BY_ERA,
  PRICE_INDEX_SMOOTHING,
  PRICE_SMOOTHING,
} from './constants';
import { econExt } from './ext';
import { globalEventMod } from './modifiers';

const round2 = (v: number): number => Math.round(v * 100) / 100;

function eventPriceMod(state: GameState, pd: ProductDef): number {
  let v = 1;
  for (const ev of state.events?.active ?? []) {
    if (ev.cityId || ev.area || ev.regionIds.length) continue; // only global events move the world price
    for (const k of [`price.${pd.id}`, `price.${pd.category}`, 'price.all']) {
      const x = ev.effects[k];
      if (x !== undefined && Number.isFinite(x)) v *= x;
    }
    if (ev.kind === 'priceShock' && ev.productId === pd.id && ev.effects[`price.${pd.id}`] === undefined) v *= 1 + 0.5 * ev.magnitude;
  }
  return v;
}

function seasonalOf(pd: ProductDef, month: number): number {
  const s = pd.seasonal?.[month - 1];
  return s !== undefined && Number.isFinite(s) ? s : 1;
}

function newMarketProduct(pd: ProductDef, month: number): MarketProduct {
  const seasonal = seasonalOf(pd, month);
  const price = round2(pd.basePrice * seasonal);
  return {
    price,
    basePrice: pd.basePrice,
    exportPrice: round2(price * EXPORT_PRICE_SHARE),
    seasonal,
    trend: 0,
    current: { supply: 0, demand: 0, sold: 0 },
    last: { supply: 0, demand: 0, sold: 0 },
    priceHistory: [],
    supplyHistory: [],
    demandHistory: [],
  };
}

/** Make sure every product (incl. mod products) has a market entry with sane numbers. */
export function ensureMarket(state: GameState, ctx: GameContext): void {
  const m = state.market;
  for (const pd of ctx.data.productList()) {
    const e = m.products[pd.id];
    if (!e) m.products[pd.id] = newMarketProduct(pd, state.time.month);
    else {
      e.basePrice = pd.basePrice;
      if (!Number.isFinite(e.price) || e.price <= 0) e.price = pd.basePrice;
      if (!Number.isFinite(e.exportPrice) || e.exportPrice < 0) e.exportPrice = round2(e.price * EXPORT_PRICE_SHARE);
    }
  }
  if (!Number.isFinite(m.priceIndex) || m.priceIndex <= 0) m.priceIndex = 1;
  if (!Number.isFinite(m.economyFactor) || m.economyFactor <= 0) m.economyFactor = 1;
}

/**
 * Book exported units for price statistics and export-price saturation. Used by
 * logistics for deliveries to PUBLIC export buildings (the money is paid there,
 * category 'export'); own export centers are booked by the sales system.
 */
export function recordExport(state: GameState, productId: string, qty: number): void {
  if (!(qty > 0)) return;
  const ext = econExt(state);
  ext.exportMonth[productId] = (ext.exportMonth[productId] ?? 0) + qty;
  const mp = state.market.products[productId];
  if (mp) mp.current.sold += qty;
}

/** New-game step 'market': fresh market at base prices (seasonal), interest by difficulty. */
export function marketNewGameStep(state: GameState, ctx: GameContext): void {
  state.market.products = {};
  ensureMarket(state, ctx);
  // games starting in a later era start at that era's price level
  const pi = PRICE_INDEX_BY_ERA[clamp(ctx.data.eraIndex(state.time.eraId), 0, PRICE_INDEX_BY_ERA.length - 1)]!;
  state.market.priceIndex = pi;
  for (const e of Object.values(state.market.products)) {
    e.price = round2(e.price * pi);
    e.exportPrice = round2(e.exportPrice * pi);
  }
  state.market.economyFactor = 1;
  state.market.interestRate = INTEREST_RATE[state.settings.difficulty] ?? 0.07;
  econExt(state);
}

/** Monthly close of the market (called by the economy month close, before cities reset demand). */
export function closeMarketMonth(state: GameState, ctx: GameContext): void {
  const m = state.market;
  const ext = econExt(state);
  ensureMarket(state, ctx);
  // city demand per product
  const cityDemand: Record<string, number> = {};
  for (const c of Object.values(state.cities))
    for (const [p, d] of Object.entries(c.demand)) if (d.monthly > 0) cityDemand[p] = (cityDemand[p] ?? 0) + d.monthly;
  const month = state.time.month; // new month
  // General price level drifts up with the era (slower than wages — see balance notes in constants.ts).
  const eraIdx = clamp(ctx.data.eraIndex(state.time.eraId), 0, PRICE_INDEX_BY_ERA.length - 1);
  const pi = PRICE_INDEX_BY_ERA[eraIdx]!;
  m.priceIndex = Math.round((m.priceIndex + (pi - m.priceIndex) * PRICE_INDEX_SMOOTHING) * 10000) / 10000;
  // boom / recession: world events carry an `economy` multiplier
  m.economyFactor = Math.round(clamp(globalEventMod(state, 'economy'), 0.3, 3) * 1000) / 1000;
  for (const pd of ctx.data.productList()) {
    const e = m.products[pd.id]!;
    const supply = e.current.supply;
    const demand = e.current.demand + (cityDemand[pd.id] ?? 0);
    let scarcity: number;
    if (demand > 0) scarcity = clamp(PRICE_A - (PRICE_B * supply) / demand, PRICE_MIN, PRICE_MAX);
    else scarcity = supply > 0 ? 0.85 : 1;
    const seasonal = seasonalOf(pd, month);
    const target = pd.basePrice * m.priceIndex * m.economyFactor * seasonal * scarcity * eventPriceMod(state, pd);
    const old = e.price;
    // Seasonal swings apply immediately (not smoothed): carry last month's price into the new
    // season first, then close part of the gap to the (seasonal) target. (Applying the season
    // ratio AFTER smoothing towards a seasonal target double-counted it and overshot, e.g.
    // coal at 2× base every winter.)
    const carried = old * (seasonal / (e.seasonal || 1));
    let price = carried + (target - carried) * PRICE_SMOOTHING;
    if (!Number.isFinite(price) || price <= 0) price = pd.basePrice;
    price = clamp(price, pd.basePrice * 0.3, pd.basePrice * 3);
    e.price = round2(price);
    e.seasonal = seasonal;
    e.trend = old > 0 ? clamp((e.price - old) / old / 0.1, -1, 1) : 0;
    const exported = ext.exportMonth[pd.id] ?? 0;
    const sat = clamp(1 - exported / EXPORT_SATURATION_UNITS, 0.5, 1);
    e.exportPrice = round2(e.price * EXPORT_PRICE_SHARE * sat);
    e.last = { supply: round2(supply), demand: round2(demand), sold: round2(e.current.sold) };
    e.current = { supply: 0, demand: 0, sold: 0 };
    pushHistory(e.priceHistory, e.price);
    pushHistory(e.supplyHistory, e.last.supply);
    pushHistory(e.demandHistory, e.last.demand);
  }
  ext.exportLast = ext.exportMonth;
  ext.exportMonth = {};
  ctx.bus.emit('market:updated', {});
}
