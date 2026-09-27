/**
 * Production (tick, SystemOrder.production).
 *
 *  - construction progress (constructionProgress → 1, emits building:completed)
 *  - efficiency = workers × skill × condition × tech/upgrade/event `efficiency.*`
 *    × site factor (farms: fertility, season, drought; forestry: tree density;
 *    energy: wind/sun)
 *  - a cycle advances by dt / recipe.days × efficiency while inputs are present
 *    and the output buffer has room; on completion inputs are consumed, outputs
 *    (+ byproducts) added with quality = avg input quality (raw: site quality)
 *    + recipe.qualityModifier + `quality.*` bonus
 *  - raw buildings with requiresDeposit deplete map.depositAmount
 *  - waste byproducts overflowing the buffer are disposed of at a cost
 *  - emissions are accumulated (company, global) and queued for the map
 *    (spread daily by ecology)
 *  - daily: ageing, perishable goods lose quality
 */
import type { GameContext } from '../core/context';
import { DAYS_PER_MONTH } from '../core/constants';
import { addMoney } from '../core/money';
import type { Building, BuildingStatus, GameState, Stock } from '../core/types';
import { addStock, clamp, forEachTileInRect, stockQty, takeStock } from '../core/util';
import type { BuildingDef, RecipeDef } from '../data/defs';
import { CONDITION_DECAY_PER_YEAR, WASTE_DISPOSAL_COST, WHOLESALE } from './constants';
import { econExt } from './ext';
import { buildingMod, buildingTargets, companyMod } from './modifiers';
import { buildingCapacity } from './stock';

// ---------------------------------------------------------------- runtime caches (not saved)
interface SiteInfo {
  day: number;
  /** Output speed factor from the site (fertility, forest, wind…). */
  factor: number;
  /** Base quality of raw output 0..1. */
  quality: number;
}
const siteCache = new Map<number, SiteInfo>();
/** Emissions produced since the last ecology pass: buildingId → units. */
export const pendingEmissions = new Map<number, number>();

export function resetProductionCaches(): void {
  siteCache.clear();
  pendingEmissions.clear();
}

/** Runtime caches as plain data (written into the save so a loaded game continues bit-identically). */
export interface ProductionRuntimeDump {
  site: [number, number, number, number][];
  emissions: [number, number][];
}

export function dumpProductionCaches(): ProductionRuntimeDump {
  const site: [number, number, number, number][] = [];
  for (const [id, s] of siteCache) site.push([id, s.day, s.factor, s.quality]);
  return { site, emissions: [...pendingEmissions.entries()] };
}

export function restoreProductionCaches(d: ProductionRuntimeDump | undefined): void {
  if (!d || !Array.isArray(d.site) || !Array.isArray(d.emissions)) return;
  for (const [id, day, factor, quality] of d.site) siteCache.set(id, { day, factor, quality });
  for (const [id, e] of d.emissions) pendingEmissions.set(id, e);
}

const PRODUCER_CATEGORIES = new Set(['raw', 'factory', 'recycling', 'energy']);
export const isProducer = (def: BuildingDef): boolean => PRODUCER_CATEGORIES.has(def.category);

export function setStatus(ctx: GameContext, b: Building, status: BuildingStatus): void {
  if (b.status === status) return;
  const previous = b.status;
  b.status = status;
  ctx.bus.emit('building:statusChanged', { buildingId: b.id, status, previous });
}

// ---------------------------------------------------------------- site factors
function seasonFarmFactor(state: GameState): number {
  const m = state.time.month;
  if (state.map.climate === 'tropical') return 1;
  if (m === 12 || m <= 2) return 0.75;
  if (m <= 5) return 1;
  if (m <= 8) return 1.15;
  return 1.1;
}

function regionWeather(state: GameState, x: number, y: number) {
  const w = state.weather;
  if (!w || !w.regions.length) return null;
  const cx = Math.min(w.cols - 1, Math.max(0, Math.floor(x / w.regionSize)));
  const cy = Math.min(w.rows - 1, Math.max(0, Math.floor(y / w.regionSize)));
  return w.regions[cy * w.cols + cx] ?? null;
}

/** Site factor & raw quality for a building (cached per day). */
export function siteInfo(ctx: GameContext, b: Building, def: BuildingDef): SiteInfo {
  const state = ctx.state;
  const day = state.time.totalDays;
  const cached = siteCache.get(b.id);
  if (cached && cached.day === day) return cached;
  const map = state.map;
  let factor = 1;
  let quality = 0.5;
  const tags = def.tags ?? [];
  const wx = regionWeather(state, b.x + b.w / 2, b.y + b.h / 2);
  if (tags.includes('farm')) {
    let fert = 0;
    let poll = 0;
    let n = 0;
    forEachTileInRect(map, b.x, b.y, b.w, b.h, (i) => {
      fert += map.fertility[i]!;
      poll += map.pollution[i]!;
      n++;
    });
    fert /= Math.max(1, n);
    poll /= Math.max(1, n);
    const pollF = clamp(1 - poll / 400, 0.5, 1);
    const drought = wx ? clamp(1 - 0.6 * Math.max(0, wx.drought - 0.3) / 0.7, 0.4, 1) : 1;
    const storm = wx && wx.kind === 'storm' ? 0.9 : 1;
    factor = clamp(fert / 160, 0.5, 1.4) * seasonFarmFactor(state) * drought * storm * pollF;
    quality = clamp(0.25 + 0.5 * (fert / 255) - poll / 800, 0.05, 1);
  } else if (tags.includes('forestry')) {
    let forest = 0;
    let n = 0;
    forEachTileInRect(map, b.x, b.y, b.w, b.h, (i) => {
      forest += map.forest[i]!;
      n++;
    });
    forest /= Math.max(1, n);
    factor = clamp(0.3 + forest / 200, 0.3, 1.3);
    quality = clamp(0.35 + forest / 600, 0, 1);
  } else if (def.requiresDeposit) {
    let q = 0;
    let amt = 0;
    const want = def.requiresDeposit;
    forEachTileInRect(map, b.x, b.y, b.w, b.h, (i) => {
      if (map.depositTypes[map.deposit[i]!] !== want) return;
      const a = map.depositAmount[i]!;
      if (a <= 0) return;
      q += (map.depositQuality[i]! / 255) * a;
      amt += a;
    });
    quality = amt > 0 ? clamp(0.1 + 0.8 * (q / amt), 0, 1) : 0.5;
  } else if (def.category === 'energy' && (def.power ?? 0) > 0 && !def.recipes.length) {
    if (tags.includes('green') && def.id.includes('wind')) factor = wx ? clamp(0.35 + 1.1 * wx.wind, 0.2, 1.4) : 0.8;
    else if (def.id.includes('solar')) {
      const m = state.time.month;
      const season = m >= 5 && m <= 8 ? 1.25 : m >= 11 || m <= 2 ? 0.5 : 0.9;
      const sky = wx ? (wx.kind === 'clear' || wx.kind === 'heat' ? 1.1 : wx.kind === 'cloudy' || wx.kind === 'fog' ? 0.6 : 0.4) : 0.9;
      factor = season * sky;
    }
  }
  const info = { day, factor, quality };
  siteCache.set(b.id, info);
  return info;
}

// ---------------------------------------------------------------- efficiency
/** Overall efficiency of an operating building (0..~2). */
export function computeEfficiency(ctx: GameContext, b: Building, def: BuildingDef): number {
  const req = b.workers.required;
  const workerF = req > 0 ? clamp(b.workers.employed / req, 0, 1) * (0.85 + 0.3 * clamp(b.workers.skill, 0, 1)) : 1;
  const condF = 0.5 + 0.5 * clamp(b.condition, 0, 1);
  return workerF * condF * buildingMod(ctx.state, b, def, 'efficiency');
}

function qualityBonus(ctx: GameContext, b: Building, def: BuildingDef): number {
  return buildingMod(ctx.state, b, def, 'quality') - 1 + (clamp(b.workers.skill, 0, 1) - 0.5) * 0.1;
}

// ---------------------------------------------------------------- deposits
function depositRemaining(state: GameState, b: Building, want: string): number {
  const map = state.map;
  let amt = 0;
  forEachTileInRect(map, b.x, b.y, b.w, b.h, (i) => {
    if (map.depositTypes[map.deposit[i]!] === want) amt += Math.max(0, map.depositAmount[i]!);
  });
  return amt;
}

/** Remove `qty` units from deposit tiles under the building, proportionally. Returns units extracted. */
function extractDeposit(state: GameState, b: Building, want: string, qty: number): number {
  const map = state.map;
  const total = depositRemaining(state, b, want);
  if (total <= 0) return 0;
  const take = Math.min(qty, total);
  forEachTileInRect(map, b.x, b.y, b.w, b.h, (i) => {
    if (map.depositTypes[map.deposit[i]!] !== want) return;
    const a = Math.max(0, map.depositAmount[i]!);
    map.depositAmount[i] = Math.max(0, a - (take * a) / total);
  });
  return take;
}

// ---------------------------------------------------------------- cycle
const price = (state: GameState, p: string, fallback: number): number => state.market.products[p]?.price ?? fallback;

function hasInputs(b: Building, r: RecipeDef): boolean {
  for (const io of r.inputs) if (stockQty(b.input, io.product) + 1e-9 < io.qty) return false;
  return true;
}

function outputRoom(b: Building, r: RecipeDef, cap: number): boolean {
  for (const io of r.outputs) if (stockQty(b.output, io.product) + io.qty > cap + 1e-9) return false;
  return true;
}

function addTo(amounts: Record<string, number>, k: string, v: number): void {
  amounts[k] = (amounts[k] ?? 0) + v;
}

/** Complete one production cycle. Returns false if it could not complete. */
function completeCycle(ctx: GameContext, b: Building, def: BuildingDef, r: RecipeDef, cap: number): boolean {
  const state = ctx.state;
  if (!hasInputs(b, r)) return false;
  let scale = 1;
  if (def.requiresDeposit && r.inputs.length === 0 && r.outputs.length) {
    const want = r.outputs.reduce((s, o) => s + o.qty, 0);
    const got = extractDeposit(state, b, def.requiresDeposit, want);
    if (got <= 0) return false;
    scale = got / want;
  }
  // inputs → quality (value-weighted)
  let qSum = 0;
  let wSum = 0;
  let inputValue = 0;
  for (const io of r.inputs) {
    const t = takeStock(b.input, io.product, io.qty);
    const pd = ctx.data.products[io.product];
    const w = t.qty * (pd?.basePrice ?? 1);
    qSum += t.quality * w;
    wSum += w;
    inputValue += t.qty * price(state, io.product, pd?.basePrice ?? 0);
    addTo(b.stats.consumedMonth, io.product, t.qty);
    const mpIn = state.market.products[io.product];
    if (mpIn) mpIn.current.demand += t.qty;
  }
  const inQ = wSum > 0 ? qSum / wSum : 0.5;
  // raw buildings: site quality dominates (inputs like fertilizer only nudge it)
  const baseQ = def.category === 'raw' ? (r.inputs.length ? 0.75 * siteInfo(ctx, b, def).quality + 0.25 * inQ : siteInfo(ctx, b, def).quality) : r.inputs.length ? inQ : 0.5;
  const quality = clamp(baseQ + r.qualityModifier + qualityBonus(ctx, b, def), 0.02, 1);
  let outValue = 0;
  let produced = 0;
  for (const io of r.outputs) {
    const q = io.qty * scale;
    addStock(b.output, io.product, q, quality);
    addTo(b.stats.producedMonth, io.product, q);
    produced += q;
    const pd = ctx.data.products[io.product];
    outValue += q * price(state, io.product, pd?.basePrice ?? 0);
    const mp = state.market.products[io.product];
    if (mp) mp.current.supply += q;
  }
  for (const io of r.byproducts ?? []) {
    const q = io.qty * scale;
    const room = Math.max(0, cap - stockQty(b.output, io.product));
    const kept = Math.min(room, q);
    addStock(b.output, io.product, kept, clamp(baseQ, 0.05, 1));
    addTo(b.stats.producedMonth, io.product, q);
    const pd = ctx.data.products[io.product];
    const mp = state.market.products[io.product];
    if (mp) mp.current.supply += q;
    if (q - kept > 1e-6 && pd?.isWaste) {
      const fee = (q - kept) * WASTE_DISPOSAL_COST;
      addMoney(ctx, b.owner, -fee, 'otherExpense');
      b.stats.costMonth += fee;
    }
  }
  b.stats.totalProduced += produced;
  b.stats.revenueMonth += outValue * WHOLESALE;
  b.stats.costMonth += inputValue * WHOLESALE;
  const first = r.outputs[0];
  if (first) ctx.bus.emit('building:produced', { buildingId: b.id, productId: first.product, qty: first.qty * scale });
  return true;
}

// ---------------------------------------------------------------- systems
export function productionSystem(state: GameState, dt: number, ctx: GameContext): void {
  const ext = econExt(state);
  for (const id in state.buildings) {
    const b = state.buildings[id]!;
    const def = ctx.data.buildings[b.typeId];
    if (!def) continue;
    const company = state.companies[b.owner];

    // construction
    if (b.constructionProgress < 1) {
      const speed = companyMod(company, 'buildSpeed', buildingTargets(def));
      b.constructionProgress = def.buildDays > 0 ? Math.min(1, b.constructionProgress + (dt / def.buildDays) * speed) : 1;
      if (b.constructionProgress >= 1) {
        setStatus(ctx, b, 'ok');
        b.efficiency = 0;
        ctx.bus.emit('building:completed', { buildingId: b.id });
        ctx.bus.emit('sfx', { id: 'success', x: b.x, y: b.y });
      } else setStatus(ctx, b, 'construction');
      continue;
    }
    const u = (ext.util[b.id] ??= [0, 0]);
    u[1] += dt;
    if (!b.enabled || (company && company.bankrupt)) {
      b.efficiency = 0;
      setStatus(ctx, b, 'disabled');
      continue;
    }
    if (b.condition < 0.25) {
      b.efficiency = 0;
      setStatus(ctx, b, 'damaged');
      continue;
    }
    let eff = computeEfficiency(ctx, b, def);
    if (b.workers.required > 0 && b.workers.employed < b.workers.required * 0.25) {
      b.efficiency = eff;
      setStatus(ctx, b, 'noWorkers');
      continue;
    }
    if (!isProducer(def)) {
      b.efficiency = eff;
      // shops set their own status in sales; others are simply operating
      if (def.category !== 'shop') setStatus(ctx, b, 'ok');
      if (def.category !== 'shop' && def.category !== 'export') u[0] += dt * Math.min(1, eff);
      continue;
    }
    const r = b.recipeId ? ctx.data.recipes[b.recipeId] : undefined;
    const site = siteInfo(ctx, b, def);
    eff *= site.factor;
    b.efficiency = eff;
    if (!r) {
      // recipe-less producers (wind/solar) run whenever staffed
      setStatus(ctx, b, 'ok');
      u[0] += dt * Math.min(1, eff);
      continue;
    }
    const cap = buildingCapacity(ctx, b, def);
    if (def.requiresDeposit && depositRemaining(state, b, def.requiresDeposit) <= 0) {
      setStatus(ctx, b, 'noDeposit');
      continue;
    }
    if (!hasInputs(b, r)) {
      setStatus(ctx, b, 'noInput');
      continue;
    }
    if (!outputRoom(b, r, cap)) {
      setStatus(ctx, b, 'outputFull');
      continue;
    }
    setStatus(ctx, b, 'ok');
    u[0] += dt * Math.min(1, eff);
    b.progress += (dt / Math.max(0.1, r.days)) * eff;
    // emissions while running
    if (def.pollution > 0) {
      const e = def.pollution * (dt / DAYS_PER_MONTH) * Math.min(eff, 1.5) * buildingMod(state, b, def, 'emissions');
      if (e > 0) {
        if (company) company.emissionsMonth += e;
        state.ecology.co2Month += e;
        state.ecology.co2Total += e;
        pendingEmissions.set(b.id, (pendingEmissions.get(b.id) ?? 0) + e);
      }
    }
    let guard = 0;
    while (b.progress >= 1 && guard++ < 5) {
      if (!completeCycle(ctx, b, def, r, cap)) {
        b.progress = Math.min(b.progress, 1);
        break;
      }
      b.progress -= 1;
      if (!hasInputs(b, r) || !outputRoom(b, r, cap)) {
        b.progress = Math.min(b.progress, 0.999);
        break;
      }
    }
  }
}

function decayStockQuality(s: Stock, ctx: GameContext, perishMul: number): void {
  for (const pid in s) {
    const pd = ctx.data.products[pid];
    if (!pd?.perishableDays) continue;
    const e = s[pid]!;
    e.quality = Math.max(0.05, e.quality - (0.5 / pd.perishableDays) * perishMul);
  }
}

/** Daily: ageing and perishable quality loss. */
export function productionDailySystem(state: GameState, _dt: number, ctx: GameContext): void {
  const decay = CONDITION_DECAY_PER_YEAR / 360;
  for (const id in state.buildings) {
    const b = state.buildings[id]!;
    if (b.constructionProgress < 1) continue;
    b.condition = Math.max(0, b.condition - decay);
    const perish = companyMod(state.companies[b.owner], 'perish', ['all']);
    decayStockQuality(b.input, ctx, perish);
    decayStockQuality(b.output, ctx, perish);
    decayStockQuality(b.storage, ctx, perish);
  }
}
