/**
 * Objective specs (scenario authoring format), resolution against the current
 * data/map (product candidates, city selectors) and evaluation of progress.
 */
import type { GameContext } from '../core/context';
import { cityPopulation } from '../core/entities';
import type { Building, City, CityId, GameState, Objective, ObjectiveKind, TransportMode } from '../core/types';
import { gameExt, type ObjectiveMeta } from './tracking';

export type CitySelector = 'largest' | 'second' | 'third' | 'smallest' | 'port';

export interface ObjectiveSpec {
  id: string;
  kind: ObjectiveKind;
  /** Title/description; `{product}` and `{city}` are replaced after resolution. */
  title: string;
  description?: string;
  /** Candidate product ids — first one existing in the registry is used. */
  products?: string[];
  city?: CitySelector;
  techs?: string[];
  target: number;
  /** Deadline in game years from start (null = none). */
  deadlineYears?: number;
  optional?: boolean;
  reward?: number;
  meta?: ObjectiveMeta;
  /** Used when products/techs can't be resolved (e.g. data changed). */
  fallback?: Omit<ObjectiveSpec, 'id' | 'fallback'>;
}

export function resolveProduct(ctx: GameContext, candidates: string[] | undefined): string | null {
  for (const id of candidates ?? []) if (ctx.data.products[id]) return id;
  return null;
}

/** Products whose id or name contains a keyword (fallback search). */
export function findProducts(ctx: GameContext, keywords: string[]): string[] {
  const out: string[] = [];
  for (const p of ctx.data.productList()) {
    const hay = `${p.id} ${p.name}`.toLowerCase();
    if (keywords.some((k) => hay.includes(k))) out.push(p.id);
  }
  return out;
}

export function selectCity(state: GameState, sel: CitySelector | undefined): City | null {
  const list = Object.values(state.cities).sort((a, b) => cityPopulation(b) - cityPopulation(a));
  if (!list.length) return null;
  switch (sel) {
    case 'second':
      return list[1] ?? list[0]!;
    case 'third':
      return list[2] ?? list[list.length - 1]!;
    case 'smallest':
      return list[list.length - 1]!;
    case 'port':
      return list.find((c) => c.isPort) ?? list[0]!;
    default:
      return list[0]!;
  }
}

/** Build an Objective from a spec (null = could not be resolved). */
export function resolveObjective(ctx: GameContext, state: GameState, spec: ObjectiveSpec, startDay = 0): { obj: Objective; meta: ObjectiveMeta } | null {
  let productId: string | null = null;
  if (spec.products) {
    productId = resolveProduct(ctx, spec.products);
    if (!productId) return spec.fallback ? resolveObjective(ctx, state, { ...spec.fallback, id: spec.id }, startDay) : null;
  }
  let techId: string | null = null;
  if (spec.techs) {
    techId = spec.techs.find((t) => ctx.data.techs[t]) ?? null;
    if (!techId) return spec.fallback ? resolveObjective(ctx, state, { ...spec.fallback, id: spec.id }, startDay) : null;
  }
  const city = spec.city ? selectCity(state, spec.city) : null;
  const pName = productId ? ctx.data.products[productId]?.name ?? productId : '';
  const fill = (s: string): string => s.replaceAll('{product}', pName).replaceAll('{city}', city?.name ?? '').replaceAll('{tech}', techId ? ctx.data.techs[techId]?.name ?? techId : '');
  const obj: Objective = {
    id: spec.id,
    kind: spec.kind,
    title: fill(spec.title),
    description: fill(spec.description ?? ''),
    productId,
    cityId: city?.id ?? 0,
    techId,
    target: spec.target,
    progress: 0,
    deadlineDay: spec.deadlineYears ? startDay + Math.round(spec.deadlineYears * 360) : null,
    optional: spec.optional ?? false,
    done: false,
    failed: false,
    reward: spec.reward ?? 0,
  };
  return { obj, meta: { ...(spec.meta ?? {}) } };
}

// ---------------------------------------------------------------- evaluation
function buildingMatches(ctx: GameContext, b: Building, meta: ObjectiveMeta, productId: string | null): boolean {
  const def = ctx.data.buildings[b.typeId];
  if (!def) return false;
  if (meta.buildingTypes?.length && !meta.buildingTypes.includes(b.typeId)) return false;
  if (meta.category && def.category !== meta.category) return false;
  if (meta.mode && def.stationMode !== meta.mode) return false;
  if (productId && !def.recipes.some((r) => ctx.data.recipes[r]?.outputs.some((o) => o.product === productId))) {
    if (!(def.sells ?? []).includes(productId)) return false;
  }
  return true;
}

function ledgerSum(state: GameState, companyId: number, cat: 'export' | 'sales' | 'trade'): number {
  const c = state.companies[companyId];
  if (!c) return 0;
  let s = c.finances.current.ledger[cat] ?? 0;
  for (const m of c.finances.history) s += m.ledger[cat] ?? 0;
  return s;
}

/** Custom objective evaluators (by meta.custom). */
export const CUSTOM_EVALUATORS: Record<string, (ctx: GameContext, state: GameState, o: Objective) => number> = {
  /** Player routes with at least one vehicle. */
  routes: (_ctx, s) => Object.values(s.routes).filter((r) => r.owner === s.playerCompanyId && r.vehicleIds.length > 0).length,
  /** Income from exports (all time, in money). */
  exportIncome: (_ctx, s) => ledgerSum(s, s.playerCompanyId, 'export'),
  /** Units produced by recycling. */
  recycled: (_ctx, s) => gameExt(s).recycled,
  /** Units of green products sold. */
  greenSold: (_ctx, s) => gameExt(s).greenSold,
  /** Rivals with lower valuation than the player (or bankrupt). */
  rivalsBeaten: (ctx, s) => {
    const pv = safeValue(ctx, s, s.playerCompanyId);
    return Object.values(s.companies).filter((c) => !c.isPlayer && (c.bankrupt || safeValue(ctx, s, c.id) < pv)).length;
  },
  /** Total population of all cities relative to start (percent). */
  populationGrowth: (_ctx, s) => {
    const start = gameExt(s).startPopulation;
    let pop = 0;
    for (const c of Object.values(s.cities)) pop += cityPopulation(c);
    return start > 0 ? Math.round((pop / start - 1) * 100) : 0;
  },
};

function safeValue(ctx: GameContext, s: GameState, id: number): number {
  try {
    const v = ctx.services.economy.companyValue(id);
    if (Number.isFinite(v) && v !== 0) return v;
  } catch {
    /* fallback */
  }
  return s.companies[id]?.finances.valuation ?? s.companies[id]?.cash ?? 0;
}

function supplyOf(city: City | undefined, productId: string | null): number {
  if (!city || !productId) return 0;
  return city.demand[productId]?.satisfaction ?? 0;
}

/** Current progress value of an objective (compare with target). */
export function evaluateObjective(ctx: GameContext, state: GameState, o: Objective, meta: ObjectiveMeta = {}): number {
  const pid = state.playerCompanyId;
  const player = state.companies[pid];
  if (!player) return 0;
  const ext = gameExt(state);
  switch (o.kind) {
    case 'cash':
      return player.cash;
    case 'companyValue':
      return safeValue(ctx, state, pid);
    case 'profitMonth': {
      const last = player.finances.history[player.finances.history.length - 1];
      return last ? last.profit : 0;
    }
    case 'produce':
      return o.productId ? ext.produced[o.productId] ?? 0 : Object.values(ext.produced).reduce((a, b) => a + b, 0);
    case 'deliver':
      if (!o.productId) return Object.values(ext.sold).reduce((a, b) => a + b, 0);
      return o.cityId ? ext.soldCity[`${o.cityId}:${o.productId}`] ?? 0 : ext.sold[o.productId] ?? 0;
    case 'supplyCity': {
      if (o.cityId) return supplyOf(state.cities[o.cityId], o.productId);
      const th = meta.threshold ?? 0.5;
      return Object.values(state.cities).filter((c) => supplyOf(c, o.productId) >= th).length;
    }
    case 'population': {
      if (o.cityId) return state.cities[o.cityId] ? cityPopulation(state.cities[o.cityId]!) : 0;
      let p = 0;
      for (const c of Object.values(state.cities)) p += cityPopulation(c);
      return p;
    }
    case 'research':
      if (o.techId) return player.research.unlocked[o.techId] !== undefined ? 1 : 0;
      return Object.keys(player.research.unlocked).length;
    case 'buildings': {
      let n = 0;
      for (const b of Object.values(state.buildings)) if (b.owner === pid && buildingMatches(ctx, b, meta, o.productId)) n++;
      return n;
    }
    case 'vehicles': {
      let n = 0;
      for (const v of Object.values(state.vehicles)) if (v.owner === pid && (!meta.mode || v.mode === (meta.mode as TransportMode))) n++;
      return n;
    }
    case 'reputation':
      return player.reputation;
    case 'ecoRating':
      return player.ecoRating;
    case 'marketShare': {
      if (!o.productId) return 0;
      const share = (m: Record<number, number> | undefined): number => {
        if (!m) return 0;
        let total = 0;
        for (const v of Object.values(m)) total += v;
        return total > 0 ? (m[pid] ?? 0) / total : 0;
      };
      return Math.max(share(ext.shareLast[o.productId]), share(ext.shareMonth[o.productId]));
    }
    case 'custom': {
      const fn = meta.custom ? CUSTOM_EVALUATORS[meta.custom] : undefined;
      return fn ? fn(ctx, state, o) : 0;
    }
    default:
      return 0;
  }
}

/** Human-readable progress "12 / 300", "45% / 80%" etc. */
export function formatProgress(o: Objective): string {
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const n = (v: number): string => Math.round(v).toLocaleString('pl-PL');
  switch (o.kind) {
    case 'marketShare':
      return `${pct(o.progress)} / ${pct(o.target)}`;
    case 'supplyCity':
      return o.cityId ? `${pct(o.progress)} / ${pct(o.target)}` : `${n(o.progress)} / ${n(o.target)}`;
    case 'research':
      return o.techId ? (o.progress >= 1 ? 'zbadane' : 'w toku') : `${n(o.progress)} / ${n(o.target)}`;
    case 'cash':
    case 'companyValue':
    case 'profitMonth':
      return `${n(o.progress)} zł / ${n(o.target)} zł`;
    default:
      return `${n(o.progress)} / ${n(o.target)}`;
  }
}

export function objectiveRatio(o: Objective): number {
  if (o.target <= 0) return o.done ? 1 : 0;
  return Math.max(0, Math.min(1, o.progress / o.target));
}

/** Resolve city id to name (helper for UI). */
export function cityName(state: GameState, id: CityId): string {
  return state.cities[id]?.name ?? '';
}
