/**
 * Scripted "reasonable human player" for balance tests (headless only; the game
 * never imports this). It plays the PLAYER company through the same services the
 * UI uses and mimics a sensible, not optimal, human:
 *
 *  - month 0: builds the best-looking first chain next to a city (chain view /
 *    advisor would show the same candidates), connects every link by road
 *    (autoConnect = the "Połącz" tool) with a vehicle each;
 *  - every `chainEveryMonths` months, when cash allows (keeps a reserve), adds
 *    another chain — a different product or city;
 *  - every 10 days: adds vehicles on links whose producer output piles up,
 *    sells vehicles stuck without a path;
 *  - research: always researching something useful (efficiency / automation /
 *    era techs first) with a modest budget;
 *  - no loans, no shop price games, no takeovers.
 *
 * Memory lives in a plain JS object owned by the test (not in the game state).
 */
import type { GameContext } from '../core/context';
import type { Company, CompanyId } from '../core/types';
import { stockQty } from '../core/util';
import { bestVehicle, citiesByOpportunity, consumerProducts, estimateChain, type ChainEstimate } from './analysis';
import { connect, flattenChain, planSites, type SpecEntry } from './competitor';
import { findSite } from './placement';

export interface ScriptedPlayerOptions {
  /** Months between new chains (when affordable). */
  chainEveryMonths: number;
  /** Stop expanding after this many chains. */
  maxChains: number;
  /** Cash kept aside when starting a new chain. */
  reserve: number;
  /** Research at all. */
  research: boolean;
  /** Max vehicles per link. */
  maxVehiclesPerLink: number;
  /** Switch long, saturated road links to rail once railways are researched. */
  rail: boolean;
}

export interface ScriptedChain {
  product: string;
  cityId: number;
  spec: SpecEntry[];
  ids: number[];
  routes: number[];
  day: number;
  capital: number;
  est: number;
  /** Link indices whose connection failed at least once (logged once). */
  failed?: number[];
  /** Link index → rail route id (0 = rail attempt failed, don't retry). */
  rail?: Record<number, number>;
}

export interface ScriptedPlayer {
  companyId: CompanyId;
  opts: ScriptedPlayerOptions;
  chains: ScriptedChain[];
  lastChainDay: number;
  log: string[];
  /** vehicle id → consecutive maintenance checks spent in 'noPath'. */
  noPath: Record<number, number>;
  /** "product:cityId" of chains closed for losses (not rebuilt). */
  closed: string[];
}

export const DEFAULT_SCRIPTED: ScriptedPlayerOptions = { chainEveryMonths: 4, maxChains: 8, reserve: 15000, research: true, maxVehiclesPerLink: 4, rail: true };

export function createScriptedPlayer(ctx: GameContext, opts: Partial<ScriptedPlayerOptions> = {}): ScriptedPlayer {
  return { companyId: ctx.state.playerCompanyId, opts: { ...DEFAULT_SCRIPTED, ...opts }, chains: [], lastChainDay: -1e9, log: [], noPath: {}, closed: [] };
}

/** Call once per game day (after ctx.sim.advanceDays(1)). */
export function scriptedPlayerDay(ctx: GameContext, p: ScriptedPlayer): void {
  const state = ctx.state;
  const c = state.companies[p.companyId];
  if (!c || c.bankrupt) return;
  const day = state.time.totalDays;
  if (day % 10 === 0) maintain(ctx, p, c);
  if (day % 180 === 90) pruneLosers(ctx, p, c);
  if (p.opts.research && day % 30 === 5) research(ctx, c);
  if (p.opts.rail && day % 90 === 45) railUpgrade(ctx, p, c);
  const due = day - p.lastChainDay >= p.opts.chainEveryMonths * 30;
  if (due && p.chains.length < p.opts.maxChains && day % 15 === 0) expand(ctx, p, c);
}

function pick(ctx: GameContext, p: ScriptedPlayer, c: Company): ChainEstimate | null {
  const taken = new Set([...p.chains.map((ch) => `${ch.product}:${ch.cityId}`), ...p.closed]);
  const products = new Map<string, number>();
  for (const ch of p.chains) products.set(ch.product, (products.get(ch.product) ?? 0) + 1);
  let best: ChainEstimate | null = null;
  let bestScore = -Infinity;
  for (const pid of consumerProducts(ctx)) {
    if (!ctx.services.economy.isUnlocked(c.id, 'product', pid)) continue;
    for (const { city } of citiesByOpportunity(ctx, c.id, pid).slice(0, 3)) {
      if (taken.has(`${pid}:${city.id}`)) continue;
      const est = estimateChain(ctx, c.id, pid, city, { balance: true, maxBuildings: 10 });
      // a sensible human skips chains that would not pay back within ~2 years
      if (!est || est.profit <= 0 || est.roi < 1 / 24 || est.capital > c.cash - reserveOf(p, c)) continue;
      // Humans like variety a bit and prefer fast payback, but weigh absolute profit too.
      const score = est.profit * (1 + est.roi * 5) * (products.has(pid) ? 0.8 : 1);
      if (score > bestScore) {
        bestScore = score;
        best = est;
      }
    }
  }
  return best;
}

/** Cash kept aside: the configured floor or ~3 months of running costs, whichever is higher. */
function reserveOf(p: ScriptedPlayer, c: Company): number {
  const h = c.finances.history.slice(-3);
  const expenses = h.length ? h.reduce((s, m) => s + m.expenses, 0) / h.length : 0;
  return Math.max(p.opts.reserve, expenses * 3);
}

function expand(ctx: GameContext, p: ScriptedPlayer, c: Company): void {
  const est = pick(ctx, p, c);
  if (!est) return;
  const city = ctx.state.cities[est.cityId]!;
  const spec = flattenChain(est);
  const ids = spec.map(() => 0);
  const sites = planSites(ctx, c, city, spec, ids);
  if (!sites || !sites.every((s) => s)) {
    p.log.push(`${ctx.state.time.year}: no sites for ${est.productId}@${city.name}`);
    p.lastChainDay = ctx.state.time.totalDays - p.opts.chainEveryMonths * 30 + 30; // retry in a month
    return;
  }
  for (let i = 0; i < spec.length; i++) {
    const s = sites[i]!;
    const r = ctx.services.economy.build(c.id, spec[i]!.t, s.x, s.y, s.rotation);
    if (!r.ok) {
      p.log.push(`${ctx.state.time.year}: build ${spec[i]!.t} failed: ${r.reason}`);
      continue;
    }
    ids[i] = r.id;
    if (spec[i]!.r) ctx.services.economy.setRecipe(r.id, spec[i]!.r!);
  }
  const ch: ScriptedChain = { product: est.productId, cityId: city.id, spec, ids, routes: spec.map(() => 0), day: ctx.state.time.totalDays, capital: est.capital, est: est.profit };
  p.chains.push(ch);
  p.lastChainDay = ctx.state.time.totalDays;
  p.log.push(`${ctx.state.time.year}/${ctx.state.time.month}: chain ${est.productId}@${city.name} cap ${Math.round(est.capital)} est ${Math.round(est.profit)}/m`);
  linkChain(ctx, p, c, ch);
}

function linkChain(ctx: GameContext, p: ScriptedPlayer, c: Company, ch: ScriptedChain): void {
  for (let i = 1; i < ch.spec.length; i++) {
    if (ch.routes[i] && ctx.state.routes[ch.routes[i]!]) continue;
    const a = ch.ids[i];
    const b = ch.ids[ch.spec[i]!.c];
    if (!a || !b || !ctx.state.buildings[a] || !ctx.state.buildings[b]) continue;
    const r = connect(ctx, c, a, b, ch.spec[i]!.p);
    if (r.ok) ch.routes[i] = r.routeId;
    else if (!ch.failed?.includes(i)) {
      (ch.failed ??= []).push(i);
      p.log.push(`${ctx.state.time.year}: link ${ch.spec[i]!.t}→${ch.spec[ch.spec[i]!.c]!.t} (${ch.product}) failed: ${r.reason}`);
    }
  }
}

function maintain(ctx: GameContext, p: ScriptedPlayer, c: Company): void {
  const state = ctx.state;
  for (const ch of p.chains) {
    linkChain(ctx, p, c, ch);
    for (let i = 1; i < ch.spec.length; i++) {
      const route = ch.routes[i] ? state.routes[ch.routes[i]!] : undefined;
      const b = ch.ids[i] ? state.buildings[ch.ids[i]!] : undefined;
      if (!route || !b) continue;
      const cap = Math.max(1, ctx.data.buildings[b.typeId]?.capacity ?? 100);
      const waiting = stockQty(b.output, ch.spec[i]!.p);
      if (route.vehicleIds.length >= p.opts.maxVehiclesPerLink || (route.vehicleIds.length > 0 && waiting < cap * 0.5)) continue;
      const consumer = ch.ids[ch.spec[i]!.c] ? state.buildings[ch.ids[ch.spec[i]!.c]!] : undefined;
      if (consumer && stockQty(consumer.input, ch.spec[i]!.p) > Math.max(1, ctx.data.buildings[consumer.typeId]?.capacity ?? 100) * 0.5) continue;
      const vid = bestVehicle(ctx, c.id, route.mode === 'rail' ? 'rail' : route.mode === 'water' ? 'water' : 'road', ch.spec[i]!.p);
      const cost = vid ? ctx.data.vehicles[vid]?.cost ?? Infinity : Infinity;
      if (vid && c.cash > cost + p.opts.reserve / 2) ctx.services.logistics.buyVehicle(c.id, vid, route.id);
    }
  }
  // running out of cash: take a loan like the finance warning suggests (never let it go bankrupt)
  if (c.cash < 5000 && c.loans.length < 3) {
    const debt = c.loans.reduce((sum, l) => sum + l.remaining, 0);
    const room = Math.floor((c.creditLimit - debt) / 1000) * 1000;
    const want = Math.max(10000, Math.round(-c.cash / 1000) * 1000 + 15000);
    if (room >= 5000) {
      const r = ctx.services.economy.takeLoan(c.id, Math.min(room, want), 36);
      if (r.ok) p.log.push(`${state.time.year}/${state.time.month}: loan ${Math.min(room, want)}`);
    }
  }
  // depleted mines: demolish and rebuild next to a fresh deposit, reconnect
  for (const ch of p.chains) {
    for (let i = 1; i < ch.spec.length; i++) {
      const b = ch.ids[i] ? state.buildings[ch.ids[i]!] : undefined;
      if (!b || b.status !== 'noDeposit') continue;
      const route = ch.routes[i] ? state.routes[ch.routes[i]!] : undefined;
      if (route) {
        for (const vid of [...route.vehicleIds]) ctx.services.logistics.sellVehicle(vid);
        ctx.services.logistics.removeRoute(route.id);
      }
      ctx.services.economy.demolish(b.id);
      ch.ids[i] = 0;
      ch.routes[i] = 0;
      if (ch.rail) delete ch.rail[i];
      const city = state.cities[ch.cityId];
      const sites = city ? planSites(ctx, c, city, ch.spec, ch.ids) : null;
      const site = sites?.[i];
      const r = site ? ctx.services.economy.build(c.id, ch.spec[i]!.t, site.x, site.y, site.rotation) : null;
      if (r?.ok) {
        ch.ids[i] = r.id;
        if (ch.spec[i]!.r) ctx.services.economy.setRecipe(r.id, ch.spec[i]!.r!);
        p.log.push(`${state.time.year}/${state.time.month}: relocated depleted ${ch.spec[i]!.t} (${ch.product})`);
      } else p.log.push(`${state.time.year}/${state.time.month}: no new site for depleted ${ch.spec[i]!.t} (${ch.product})`);
    }
  }
  // repair what disasters broke (the game notifies the player about it)
  for (const b of Object.values(state.buildings)) {
    if (b.owner !== c.id || b.condition >= 0.5 || b.constructionProgress < 1) continue;
    ctx.services.economy.repairBuilding?.(b.id);
  }
  // routes that moved nothing for a year: sell their vehicles (the link is re-created if needed)
  for (const ch of p.chains)
    for (let i = 1; i < ch.spec.length; i++) {
      const r = ch.routes[i] ? state.routes[ch.routes[i]!] : undefined;
      if (!r || state.time.totalDays - r.createdDay < 400) continue;
      const h = r.stats.throughputHistory;
      if (h.length < 12 || h.slice(-12).some((u) => u > 0)) continue;
      for (const vid of [...r.vehicleIds]) ctx.services.logistics.sellVehicle(vid);
      ctx.services.logistics.removeRoute(r.id);
      ch.routes[i] = 0;
    }
  // sell vehicles that could not find a path for ~a month (3 checks in a row)
  const seen: Record<number, number> = {};
  for (const v of Object.values(state.vehicles)) {
    if (v.owner !== c.id || v.status !== 'noPath') continue;
    seen[v.id] = (p.noPath[v.id] ?? 0) + 1;
    if (seen[v.id]! >= 3) ctx.services.logistics.sellVehicle(v.id);
  }
  p.noPath = seen;
}

/**
 * Trucks → trains: a long road link that is saturated gets a rail line — a station next to
 * the producer and one next to the consumer (catchment radius), autoConnect('rail') builds the
 * track, the route and buys a train. The road route keeps running alongside.
 */
function railUpgrade(ctx: GameContext, p: ScriptedPlayer, c: Company): void {
  const state = ctx.state;
  const E = ctx.services.economy;
  if (!E.isUnlocked(c.id, 'building', 'train_station')) return;
  for (const ch of p.chains) {
    for (let i = 1; i < ch.spec.length; i++) {
      if (ch.rail?.[i] !== undefined) continue;
      const a = ch.ids[i] ? state.buildings[ch.ids[i]!] : undefined;
      const b = ch.ids[ch.spec[i]!.c] ? state.buildings[ch.ids[ch.spec[i]!.c]!] : undefined;
      const road = ch.routes[i] ? state.routes[ch.routes[i]!] : undefined;
      if (!a || !b || !road) continue;
      const dist = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (dist < 22 || road.vehicleIds.length < p.opts.maxVehiclesPerLink) continue;
      const stationCost = ctx.data.buildings.train_station?.cost ?? 12000;
      if (c.cash < stationCost * 2 + 40000 + reserveOf(p, c)) return;
      (ch.rail ??= {})[i] = 0;
      const place = (t: typeof a): number => {
        const cx = t.x + t.w / 2;
        const cy = t.y + t.h / 2;
        const site = findSite(ctx, c.id, 'train_station', cx, cy, { minR: 1, maxR: 3, candidates: 3, spacing: false, maxChecks: 300 });
        if (!site) return 0;
        const r = E.build(c.id, 'train_station', site.x, site.y, site.rotation);
        return r.ok ? r.id : 0;
      };
      const sa = place(a);
      const sb = sa ? place(b) : 0;
      const res = sa && sb ? ctx.services.logistics.autoConnect(c.id, a.id, b.id, 'rail') : { ok: false as const, reason: 'Brak miejsca na stację' };
      if (res.ok) {
        ch.rail[i] = res.routeId;
        const w = (res as { warning?: string }).warning;
        p.log.push(`${state.time.year}/${state.time.month}: rail link ${ch.spec[i]!.t}→${ch.spec[ch.spec[i]!.c]!.t} (${ch.product}), ${dist} tiles${w ? ` (${w})` : ''}`);
      } else {
        for (const id of [sa, sb]) if (id) E.demolish(id);
        p.log.push(`${state.time.year}/${state.time.month}: rail link for ${ch.product} failed: ${res.reason}`);
      }
      return; // one project per check
    }
  }
}

/** A sensible human shuts down chains that have been losing money for half a year. */
function pruneLosers(ctx: GameContext, p: ScriptedPlayer, c: Company): void {
  const state = ctx.state;
  for (const ch of [...p.chains]) {
    if (state.time.totalDays - ch.day < 360) continue;
    let sum = 0;
    for (const id of ch.ids) {
      const b = id ? state.buildings[id] : undefined;
      if (b) for (const v of b.stats.profitHistory.slice(-6)) sum += v;
    }
    for (const rid of [...ch.routes, ...Object.values(ch.rail ?? {})]) {
      const r = rid ? state.routes[rid] : undefined;
      if (r) for (const v of r.stats.profitHistory.slice(-6)) sum += Math.min(0, v);
    }
    if (sum > -3000) continue;
    for (const rid of [...ch.routes, ...Object.values(ch.rail ?? {})]) {
      const r = rid ? state.routes[rid] : undefined;
      if (!r) continue;
      for (const vid of [...r.vehicleIds]) ctx.services.logistics.sellVehicle(vid);
      ctx.services.logistics.removeRoute(r.id);
    }
    for (const id of ch.ids) if (id && state.buildings[id]?.owner === c.id) ctx.services.economy.demolish(id);
    p.chains = p.chains.filter((x) => x !== ch);
    p.closed.push(`${ch.product}:${ch.cityId}`);
    p.log.push(`${state.time.year}/${state.time.month}: closed losing chain ${ch.product} (${Math.round(sum)} over 6 months)`);
  }
}

function research(ctx: GameContext, c: Company): void {
  const E = ctx.services.economy;
  const rs = c.research;
  const revenue = c.finances.history.at(-1)?.revenue ?? 0;
  E.setResearchBudget?.(c.id, Math.round(Math.min(20000, Math.max(0, revenue * 0.04))));
  if (rs.current) return;
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const t of ctx.data.techList()) {
    if (rs.unlocked[t.id] !== undefined) continue;
    if (!t.prereqs.every((q) => rs.unlocked[q] !== undefined)) continue;
    let score = -t.cost / 200;
    for (const e of t.effects) {
      if (e.kind === 'modifier') score += e.key.startsWith('efficiency') || e.key.startsWith('workers') ? 4 : 1.5;
      else if (e.kind === 'era') score += 5;
      else score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = t.id;
    }
  }
  if (best) (E.queueResearch ?? E.startResearch)(c.id, best);
}
