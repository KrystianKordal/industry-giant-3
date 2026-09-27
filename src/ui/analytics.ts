/**
 * Pure analytics helpers for the dashboard / chain view (no DOM, testable).
 */
import type { DataRegistry } from '../data/registry';
import type { Building, CompanyId, GameState, Route } from '../core/types';

export const lastOf = (a: readonly number[]): number | undefined => a[a.length - 1];

/** Profit of a building for ranking: last closed month, else running month. */
export function buildingProfit(b: Building): number {
  return lastOf(b.stats.profitHistory) ?? b.stats.revenueMonth - b.stats.costMonth;
}
export function routeProfit(r: Route): number {
  return lastOf(r.stats.profitHistory) ?? r.stats.revenueMonth - r.stats.costMonth;
}

/** Annuity monthly payment. */
export function loanPayment(amount: number, annualRate: number, months: number): number {
  const r = annualRate / 12;
  if (months <= 0) return amount;
  if (r <= 0) return amount / months;
  return (amount * r) / (1 - Math.pow(1 + r, -months));
}

export interface CompanyRank {
  id: CompanyId;
  value: number;
  cash: number;
  buildings: number;
  vehicles: number;
  profit: number;
}

export function companyRanking(st: GameState, valueOf: (id: CompanyId) => number): CompanyRank[] {
  const counts = new Map<CompanyId, { b: number; v: number }>();
  for (const b of Object.values(st.buildings)) {
    const c = counts.get(b.owner) ?? { b: 0, v: 0 };
    c.b++;
    counts.set(b.owner, c);
  }
  for (const v of Object.values(st.vehicles)) {
    const c = counts.get(v.owner) ?? { b: 0, v: 0 };
    c.v++;
    counts.set(v.owner, c);
  }
  return Object.values(st.companies)
    .map((c) => ({
      id: c.id,
      value: valueOf(c.id),
      cash: c.cash,
      buildings: counts.get(c.id)?.b ?? 0,
      vehicles: counts.get(c.id)?.v ?? 0,
      profit: lastOf(c.finances.history.map((m) => m.profit)) ?? c.finances.current.profit,
    }))
    .sort((a, b) => b.value - a.value);
}

// ============================================================================
// Production chain graph
// ============================================================================

export interface ChainNode {
  typeId: string;
  count: number;
  /** Column (chain depth). */
  depth: number;
  /** Fraction of instances starved (noInput) / blocked (outputFull). */
  starved: number;
  blocked: number;
  /** Average efficiency 0..1+. */
  efficiency: number;
  profit: number;
  outputs: string[];
  inputs: string[];
  buildingIds: number[];
}

export interface ChainEdge {
  from: string;
  to: string;
  products: string[];
  /** Units per month (last closed month or running). */
  throughput: number;
  routes: number;
  vehicles: number;
  /** true = recipe link without any route (missing connection). */
  missing: boolean;
  bottleneck: boolean;
}

export interface ChainGraph {
  nodes: ChainNode[];
  edges: ChainEdge[];
}

/** Product depth in the recipe graph (raw = 0). */
function productDepths(data: DataRegistry): Map<string, number> {
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const calc = (p: string): number => {
    const known = depth.get(p);
    if (known !== undefined) return known;
    if (visiting.has(p)) return 0;
    visiting.add(p);
    const recipes = Object.values(data.recipes).filter((r) => r.outputs.some((o) => o.product === p));
    let best = Infinity;
    for (const r of recipes) {
      const d = r.inputs.length ? 1 + Math.max(...r.inputs.map((i) => calc(i.product))) : 0;
      best = Math.min(best, d);
    }
    visiting.delete(p);
    const v = Number.isFinite(best) ? best : 0;
    depth.set(p, v);
    return v;
  };
  for (const p of Object.keys(data.products)) calc(p);
  return depth;
}

let depthCache: { version: number; map: Map<string, number> } | null = null;

export function buildChainGraph(st: GameState, data: DataRegistry, companyId: CompanyId): ChainGraph {
  if (!depthCache || depthCache.version !== data.version) depthCache = { version: data.version, map: productDepths(data) };
  const pdepth = depthCache.map;
  const nodes = new Map<string, ChainNode>();
  const typeOf = new Map<number, string>();
  for (const b of Object.values(st.buildings)) {
    if (b.owner !== companyId) continue;
    const def = data.buildings[b.typeId];
    if (!def) continue;
    typeOf.set(b.id, b.typeId);
    let n = nodes.get(b.typeId);
    if (!n) {
      const r = b.recipeId ? data.recipes[b.recipeId] : def.recipes[0] ? data.recipes[def.recipes[0]] : undefined;
      const outputs = r?.outputs.map((o) => o.product) ?? [];
      const inputs = r?.inputs.map((i) => i.product) ?? (def.category === 'shop' || def.category === 'export' ? (def.sells ?? []) : []);
      let depth: number;
      if (def.category === 'shop' || def.category === 'export') depth = 1 + Math.max(0, ...inputs.map((p) => pdepth.get(p) ?? 0));
      else if (def.category === 'warehouse' || def.category === 'station') depth = -1; // resolved later
      else depth = Math.max(0, ...outputs.map((p) => pdepth.get(p) ?? 0));
      n = { typeId: b.typeId, count: 0, depth, starved: 0, blocked: 0, efficiency: 0, profit: 0, outputs, inputs, buildingIds: [] };
      nodes.set(b.typeId, n);
    }
    n.count++;
    n.buildingIds.push(b.id);
    if (b.status === 'noInput') n.starved++;
    if (b.status === 'outputFull') n.blocked++;
    n.efficiency += b.efficiency;
    n.profit += buildingProfit(b);
  }
  for (const n of nodes.values()) {
    n.starved /= n.count;
    n.blocked /= n.count;
    n.efficiency /= n.count;
  }

  // route edges: every load stop → following unload stops
  const edges = new Map<string, ChainEdge>();
  for (const r of Object.values(st.routes)) {
    if (r.owner !== companyId || r.stops.length < 2) continue;
    const thr = lastOf(r.stats.throughputHistory) ?? Object.values(r.stats.deliveredMonth).reduce((a, b) => a + b, 0);
    const pairs: [string, string, string[]][] = [];
    for (let i = 0; i < r.stops.length; i++) {
      const s = r.stops[i]!;
      const load = s.orders.find((o) => o.action === 'load');
      if (!load) continue;
      const from = typeOf.get(s.buildingId);
      if (!from) continue;
      for (let k = 1; k < r.stops.length; k++) {
        const t = r.stops[(i + k) % r.stops.length]!;
        if (!t.orders.some((o) => o.action === 'unload')) continue;
        const to = typeOf.get(t.buildingId);
        if (to && to !== from) {
          const prods = load.products === 'all' ? (nodes.get(from)?.outputs ?? []) : load.products;
          pairs.push([from, to, prods]);
        }
        break;
      }
    }
    for (const [from, to, prods] of pairs) {
      const key = `${from}>${to}`;
      const e = edges.get(key) ?? { from, to, products: [], throughput: 0, routes: 0, vehicles: 0, missing: false, bottleneck: false };
      e.throughput += thr / Math.max(1, pairs.length);
      e.routes++;
      e.vehicles += r.vehicleIds.length;
      for (const p of prods) if (!e.products.includes(p)) e.products.push(p);
      edges.set(key, e);
    }
  }
  // recipe links without a route
  for (const a of nodes.values()) {
    for (const b of nodes.values()) {
      if (a === b) continue;
      const prods = a.outputs.filter((p) => b.inputs.includes(p));
      if (!prods.length) continue;
      const key = `${a.typeId}>${b.typeId}`;
      if (edges.has(key)) continue;
      // a hub in between counts as a connection
      edges.set(key, { from: a.typeId, to: b.typeId, products: prods, throughput: 0, routes: 0, vehicles: 0, missing: true, bottleneck: false });
    }
  }
  // hubs: depth between their sources and targets
  for (const n of nodes.values()) {
    if (n.depth >= 0) continue;
    const src = [...edges.values()].filter((e) => e.to === n.typeId).map((e) => nodes.get(e.from)?.depth ?? 0);
    n.depth = (src.length ? Math.max(...src) : 0) + 0.5;
  }
  // bottlenecks: consumer starved while the producer has goods / is blocked, or route with no vehicles
  for (const e of edges.values()) {
    const a = nodes.get(e.from);
    const b = nodes.get(e.to);
    if (!a || !b) continue;
    e.bottleneck = (!e.missing && e.vehicles === 0) || (b.starved >= 0.5 && (a.blocked > 0 || e.missing)) || (!e.missing && a.blocked >= 0.5);
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
