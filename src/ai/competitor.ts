/**
 * AI competitor brain. Runs on a slow cadence (every few game days per company,
 * time-budgeted) and acts ONLY through ctx.services (economy/logistics). It
 * never creates money: everything is paid through services (which use
 * core/money.ts). All service calls are wrapped so a failing/stub service
 * never crashes the simulation.
 *
 * Plan ("chain") params (AIPlan.params, plain data):
 *   product: string       end product
 *   city: number          target city id
 *   spec: string          JSON SpecEntry[] (entry 0 = shop)
 *   ids: number[]         building id per entry (0 = not built / lost)
 *   linked: number[]      1 when entry i delivers to its consumer (route exists)
 *   routes: number[]      route id per entry (0 = none)
 *   est: number           estimated monthly profit at creation
 *   tries: number         failed build/connect attempts
 */
import type { GameContext } from '../core/context';
import { footprintSize } from '../core/entities';
import { notify } from '../core/notify';
import { Rng } from '../core/rng';
import type { AIPlan, AIState, Building, City, Company, CompanyId, GameState, TileRect } from '../core/types';
import { dist, stockQty } from '../core/util';
import {
  bestVehicle,
  citiesByOpportunity,
  consumerProducts,
  estimateChain,
  rivalShare,
  type ChainEstimate,
  type ChainNode,
} from './analysis';
import { findSite, rawAnchor } from './placement';
import { DIFFICULTY, PERSONALITIES } from './profiles';

export interface SpecEntry {
  /** Building type. */
  t: string;
  /** Recipe (null for shops). */
  r: string | null;
  /** Product delivered to the consumer (or sold, for the shop). */
  p: string;
  /** Consumer entry index (-1 for the shop). */
  c: number;
}

const NI = 'Niezaimplementowane';

// ---------------------------------------------------------------- helpers
function mem(ai: AIState): Record<string, number | string | boolean> {
  return ai.memory;
}

function num(v: unknown, d = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

function aiRng(ai: AIState, companyId: CompanyId): Rng {
  const m = mem(ai);
  const s = num(m.rng, (companyId * 2654435761) >>> 0);
  const r = new Rng({ seed: 0, s: s >>> 0 });
  return r;
}
function saveRng(ai: AIState, r: Rng): void {
  mem(ai).rng = r.state.s;
}

/** Call a service safely; returns fallback on exception. */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[ai] service call failed', err);
    return fallback;
  }
}

export function planSpec(plan: AIPlan): SpecEntry[] {
  const raw = plan.params.spec;
  if (typeof raw !== 'string') return [];
  try {
    return JSON.parse(raw) as SpecEntry[];
  } catch {
    return [];
  }
}

function arr(plan: AIPlan, key: string, len: number): number[] {
  let a = plan.params[key];
  if (!Array.isArray(a)) a = [];
  const out = (a as number[]).slice(0, len);
  while (out.length < len) out.push(0);
  plan.params[key] = out;
  return out;
}

/** Flatten a chain tree into spec entries (entry 0 = shop). */
export function flattenChain(est: ChainEstimate): SpecEntry[] {
  const spec: SpecEntry[] = [{ t: est.shopType, r: null, p: est.productId, c: -1 }];
  const visit = (node: ChainNode, consumers: number[]): void => {
    const mine: number[] = [];
    for (let k = 0; k < node.count; k++) {
      mine.push(spec.length);
      spec.push({ t: node.buildingType, r: node.recipeId, p: node.productId, c: consumers[k % consumers.length]! });
    }
    for (const i of node.inputs) visit(i.node, mine);
  };
  visit(est.root, [0]);
  return spec;
}

function companyBuildings(state: GameState, companyId: CompanyId): Building[] {
  const out: Building[] = [];
  for (const b of Object.values(state.buildings)) if (b.owner === companyId) out.push(b);
  return out;
}

function outstandingDebt(c: Company): number {
  let d = 0;
  for (const l of c.loans) d += l.remaining;
  return d;
}

/** Average monthly profit over the last closed months (0 if none). */
function recentProfit(c: Company, months = 3): number {
  const h = c.finances.history.slice(-months);
  if (!h.length) return c.finances.current.profit;
  return h.reduce((s, m) => s + m.profit, 0) / h.length;
}

function monthlyExpenses(c: Company): number {
  const h = c.finances.history.slice(-3);
  if (!h.length) return Math.max(500, c.finances.current.expenses);
  return Math.max(500, h.reduce((s, m) => s + m.expenses, 0) / h.length);
}

// ---------------------------------------------------------------- think
export interface ThinkResult {
  actions: number;
}

/** One planner run for an AI company. Never throws (caller also guards). */
export function think(ctx: GameContext, company: Company): ThinkResult {
  const ai = company.ai!;
  const res: ThinkResult = { actions: 0 };
  if (company.bankrupt) {
    liquidate(ctx, company);
    return res;
  }
  const r = aiRng(ai, company.id);
  try {
    maintainPlans(ctx, company, res);
    manageFinances(ctx, company, res);
    manageResearch(ctx, company, res);
    if (company.cash > 0) considerNewProject(ctx, company, r, res);
    handleDistress(ctx, company, res);
  } finally {
    saveRng(ai, r);
  }
  return res;
}

// ---------------------------------------------------------------- maintenance
function maintainPlans(ctx: GameContext, c: Company, res: ThinkResult): void {
  const ai = c.ai!;
  const state = ctx.state;
  for (const plan of ai.plans) {
    if (plan.kind !== 'chain' || plan.status === 'failed' || plan.status === 'done') continue;
    const spec = planSpec(plan);
    if (!spec.length) {
      plan.status = 'failed';
      continue;
    }
    const ids = arr(plan, 'ids', spec.length);
    const linked = arr(plan, 'linked', spec.length);
    const routes = arr(plan, 'routes', spec.length);
    // lost buildings (demolished / taken over)
    for (let i = 0; i < spec.length; i++) {
      const b = ids[i] ? state.buildings[ids[i]!] : undefined;
      if (ids[i] && (!b || b.owner !== c.id)) {
        ids[i] = 0;
        linked[i] = 0;
        // links of producers delivering to this entry are gone too
        for (let j = 0; j < spec.length; j++) if (spec[j]!.c === i) linked[j] = 0;
      }
      if (routes[i] && !state.routes[routes[i]!]) {
        routes[i] = 0;
        linked[i] = 0;
      }
    }
    // (re)build missing entries if affordable
    if (ids.some((id) => !id)) {
      if (!buildMissing(ctx, c, plan, spec, ids, res)) {
        plan.params.tries = num(plan.params.tries) + 1;
        if (num(plan.params.tries) > 6 && ids.every((id) => !id)) plan.status = 'failed';
      }
    }
    // recipes & shop price
    for (let i = 0; i < spec.length; i++) {
      const b = ids[i] ? state.buildings[ids[i]!] : undefined;
      if (!b) continue;
      const e = spec[i]!;
      if (e.r && b.recipeId !== e.r) safe(() => ctx.services.economy.setRecipe(b.id, e.r!), false);
      if (b.shop) {
        const pf = PERSONALITIES[ai.personality].priceFactor;
        if (Math.abs(b.shop.priceFactor - pf) > 1e-6) {
          b.shop.priceFactor = pf;
          ctx.bus.emit('building:changed', { buildingId: b.id });
        }
      }
    }
    // connect producers to consumers
    for (let i = 1; i < spec.length; i++) {
      if (linked[i] || !ids[i] || !ids[spec[i]!.c]) continue;
      const rr = connect(ctx, c, ids[i]!, ids[spec[i]!.c]!, spec[i]!.p);
      if (rr.ok) {
        linked[i] = 1;
        routes[i] = rr.routeId;
        res.actions++;
      } else if (rr.reason === NI) {
        plan.params.logisticsMissing = true;
      }
    }
    // capacity: add vehicles on congested producer outputs
    addVehicles(ctx, c, spec, ids, routes, res);
    if (ids.every((id) => id) && linked.slice(1).every((l) => l)) plan.status = 'active';
    // give up on chains that lose money for a long time (not the aggressive ones)
    evaluatePlanProfit(ctx, c, plan, spec, ids, routes);
  }
  // drop finished/failed plans older than a year to keep saves small
  ai.plans = ai.plans.filter((p) => p.status !== 'failed' || state.time.totalDays - p.createdDay < 360);
}

function buildMissing(ctx: GameContext, c: Company, plan: AIPlan, spec: SpecEntry[], ids: number[], res: ThinkResult): boolean {
  const state = ctx.state;
  const city = state.cities[num(plan.params.city)];
  if (!city) return false;
  // Estimate missing cost first — do not start what we can't finish.
  let need = 0;
  for (let i = 0; i < spec.length; i++) if (!ids[i]) need += ctx.data.buildings[spec[i]!.t]?.cost ?? 0;
  const reserve = Math.max(2000, monthlyExpenses(c) * 0.5);
  if (c.cash < need + reserve) return false;

  const sites = planSites(ctx, c, city, spec, ids);
  if (!sites) return false;
  let builtAny = false;
  for (let i = 0; i < spec.length; i++) {
    if (ids[i]) continue;
    const site = sites[i];
    if (!site) continue;
    const r = safe(() => ctx.services.economy.build(c.id, spec[i]!.t, site.x, site.y, site.rotation), { ok: false as const, reason: 'wyjątek' });
    if (r.ok) {
      ids[i] = r.id;
      builtAny = true;
      res.actions++;
      const e = spec[i]!;
      if (e.r) safe(() => ctx.services.economy.setRecipe(r.id, e.r!), false);
      if (i === 0) announceShop(ctx, c, city, e.p);
    }
  }
  return builtAny && ids.every((id) => id);
}

/** Compute sites for all missing entries (reserving space so they don't overlap). */
function planSites(ctx: GameContext, c: Company, city: City, spec: SpecEntry[], ids: number[]): ({ x: number; y: number; rotation: 0 | 1 | 2 | 3 } | null)[] | null {
  const state = ctx.state;
  const sites: ({ x: number; y: number; rotation: 0 | 1 | 2 | 3 } | null)[] = spec.map(() => null);
  const avoid: TileRect[] = [];
  const pos: ({ x: number; y: number } | null)[] = spec.map((_, i) => {
    const b = ids[i] ? state.buildings[ids[i]!] : undefined;
    return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null;
  });
  const children = (i: number): number[] => spec.map((e, j) => (e.c === i ? j : -1)).filter((j) => j >= 0);
  const radius = Math.max(2, city.radius);
  // anchors bottom-up (raw near resources, factories between inputs and city)
  const anchor = (i: number): { x: number; y: number } => {
    if (pos[i]) return pos[i]!;
    const e = spec[i]!;
    if (i === 0) return { x: city.x, y: city.y };
    const kids = children(i);
    if (!kids.length) {
      const def = ctx.data.buildings[e.t];
      if (def?.requiresDeposit) return rawAnchor(ctx, e.t, city.x, city.y);
      return { x: city.x, y: city.y };
    }
    let sx = 0;
    let sy = 0;
    for (const k of kids) {
      const a = anchor(k);
      sx += a.x;
      sy += a.y;
    }
    return { x: (sx / kids.length + city.x) / 2, y: (sy / kids.length + city.y) / 2 };
  };
  const order = spec.map((_, i) => i).sort((a, b) => b - a); // leaves first (they were appended last)
  order.unshift(...order.splice(order.indexOf(0), 1)); // shop first: if the city has no room, abort early
  for (const i of order) {
    if (ids[i]) continue;
    const e = spec[i]!;
    const def = ctx.data.buildings[e.t];
    if (!def) return null;
    const a = anchor(i);
    let site;
    if (i === 0) {
      site =
        findSite(ctx, c.id, e.t, a.x, a.y, { minR: 0, maxR: radius + 5, avoid, candidates: 1 }) ??
        findSite(ctx, c.id, e.t, a.x, a.y, { minR: 0, maxR: radius + 7, avoid, spacing: false, candidates: 1 });
    } else if (def.requiresDeposit) {
      site = findSite(ctx, c.id, e.t, a.x, a.y, { minR: 0, maxR: 8, avoid, candidates: 3 });
    } else if (def.minFertility) {
      site = findSite(ctx, c.id, e.t, city.x, city.y, { minR: radius + 3, maxR: radius + 26, avoid, candidates: 6 });
    } else if (def.category === 'raw') {
      site = findSite(ctx, c.id, e.t, city.x, city.y, { minR: radius + 3, maxR: radius + 26, avoid, candidates: 4 });
    } else {
      site = findSite(ctx, c.id, e.t, a.x, a.y, { minR: 0, maxR: 14, avoid, candidates: 2 });
    }
    if (!site) {
      if (i === 0) return null;
      continue;
    }
    const { w, h } = footprintSize(def, site.rotation);
    avoid.push({ x: site.x, y: site.y, w, h });
    sites[i] = site;
    pos[i] = { x: site.x + w / 2, y: site.y + h / 2 };
  }
  return sites;
}

function announceShop(ctx: GameContext, c: Company, city: City, productId: string): void {
  const state = ctx.state;
  // Only tell the player when it's competition in "their" city.
  const playerSells = Object.values(state.buildings).some((b) => b.owner === state.playerCompanyId && b.shop && b.cityId === city.id);
  const share = city.demand[productId]?.shareByCompany[state.playerCompanyId] ?? 0;
  if (!playerSells && share <= 0) return;
  const p = ctx.data.products[productId];
  notify(ctx, {
    level: 'warning',
    icon: c.logo,
    title: `Konkurencja w mieście ${city.name}`,
    text: `${c.name} otwiera sklep (${p?.name ?? productId}) w mieście ${city.name}.`,
    target: { kind: 'city', id: city.id },
    category: 'ai',
    companyId: 0,
  });
}

// ---------------------------------------------------------------- logistics
type ConnectResult = { ok: true; routeId: number } | { ok: false; reason: string };

/** Producer → consumer: autoConnect, falling back to plan+build road, route and vehicle. */
export function connect(ctx: GameContext, c: Company, fromId: number, toId: number, productId: string): ConnectResult {
  const L = ctx.services.logistics;
  const auto = safe(() => L.autoConnect(c.id, fromId, toId, 'road'), { ok: false as const, reason: 'wyjątek' });
  if (auto.ok) return { ok: true, routeId: auto.routeId };
  if (auto.reason !== NI) return { ok: false, reason: auto.reason };
  return manualConnect(ctx, c, fromId, toId, productId);
}

function edgeTileToward(state: GameState, b: Building, tx: number, ty: number): number {
  const m = state.map;
  let best = -1;
  let bd = Infinity;
  for (let y = b.y - 1; y <= b.y + b.h; y++)
    for (let x = b.x - 1; x <= b.x + b.w; x++) {
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) continue;
      if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue;
      const i = y * m.width + x;
      if (m.building[i]) continue;
      const d = dist(x, y, tx, ty);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
  return best;
}

function manualConnect(ctx: GameContext, c: Company, fromId: number, toId: number, productId: string): ConnectResult {
  const state = ctx.state;
  const L = ctx.services.logistics;
  const a = state.buildings[fromId];
  const b = state.buildings[toId];
  if (!a || !b) return { ok: false, reason: 'Brak budynku' };
  if (!safe(() => L.isConnected('road', fromId, toId), false)) {
    const ta = edgeTileToward(state, a, b.x, b.y);
    const tb = edgeTileToward(state, b, a.x, a.y);
    if (ta < 0 || tb < 0) return { ok: false, reason: 'Brak miejsca na drogę' };
    const path = safe(() => L.planNetworkPath('road', ta, tb), null);
    if (!path || !path.length) return { ok: false, reason: NI };
    const est = safe(() => L.estimateNetwork(c.id, 'road', path), { ok: false as const, reason: NI });
    if (est.ok && est.cost > c.cash) return { ok: false, reason: 'Brak środków' };
    const built = safe(() => L.buildNetwork(c.id, 'road', path), { ok: false as const, reason: NI });
    if (!built.ok) return { ok: false, reason: built.reason };
  }
  const p = ctx.data.products[productId];
  const route = safe(
    () =>
      L.createRoute(c.id, {
        mode: 'road',
        name: `${p?.name ?? productId}: ${ctx.data.buildings[a.typeId]?.name ?? ''} → ${ctx.data.buildings[b.typeId]?.name ?? ''}`,
        color: c.color,
        stops: [
          { buildingId: fromId, orders: [{ action: 'load', products: [productId], limit: 0 }], waitFull: true, minLoad: 0.5 },
          { buildingId: toId, orders: [{ action: 'unload', products: [productId], limit: 0 }], waitFull: false, minLoad: 0 },
        ],
      }),
    { ok: false as const, reason: NI },
  );
  if (!route.ok) return { ok: false, reason: route.reason };
  const vid = bestVehicle(ctx, c.id, 'road');
  if (vid) safe(() => L.buyVehicle(c.id, vid, route.id), { ok: false as const, reason: NI });
  return { ok: true, routeId: route.id };
}

function addVehicles(ctx: GameContext, c: Company, spec: SpecEntry[], ids: number[], routes: number[], res: ThinkResult): void {
  const state = ctx.state;
  const diff = DIFFICULTY[c.ai!.difficulty];
  for (let i = 1; i < spec.length; i++) {
    const rid = routes[i];
    const route = rid ? state.routes[rid] : undefined;
    const b = ids[i] ? state.buildings[ids[i]!] : undefined;
    if (!route || !b) continue;
    const def = ctx.data.buildings[b.typeId];
    const cap = Math.max(1, def?.capacity ?? 100);
    const waiting = stockQty(b.output, spec[i]!.p);
    const vehicles = route.vehicleIds.length;
    if (vehicles >= diff.maxVehiclesPerLink) continue;
    if (vehicles > 0 && waiting < cap * 0.6) continue;
    const vid = bestVehicle(ctx, c.id, route.mode === 'rail' ? 'rail' : route.mode === 'water' ? 'water' : 'road');
    if (!vid) continue;
    const vcost = ctx.data.vehicles[vid]?.cost ?? Infinity;
    if (c.cash < vcost * 2) continue;
    const r = safe(() => ctx.services.logistics.buyVehicle(c.id, vid, route.id), { ok: false as const, reason: NI });
    if (r.ok) res.actions++;
  }
}

function evaluatePlanProfit(ctx: GameContext, c: Company, plan: AIPlan, spec: SpecEntry[], ids: number[], routes: number[]): void {
  const state = ctx.state;
  if (state.time.totalDays - plan.createdDay < 540) return; // give chains 1.5 years
  if (c.ai!.personality === 'aggressive') return;
  let sum = 0;
  let months = 0;
  for (const id of ids) {
    const b = id ? state.buildings[id] : undefined;
    if (!b) continue;
    const h = b.stats.profitHistory.slice(-6);
    months = Math.max(months, h.length);
    for (const v of h) sum += v;
  }
  if (months < 6) return;
  const threshold = -Math.max(3000, (num(plan.params.capital) || 20000) * 0.05);
  if (sum >= threshold) return;
  // Close the chain: sell vehicles, remove routes, demolish buildings.
  for (const rid of routes) {
    const route = rid ? state.routes[rid] : undefined;
    if (!route) continue;
    for (const vid of [...route.vehicleIds]) safe(() => ctx.services.logistics.sellVehicle(vid), { ok: false as const, reason: NI });
    safe(() => ctx.services.logistics.removeRoute(rid), false);
  }
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    if (id && state.buildings[id]?.owner === c.id) safe(() => ctx.services.economy.demolish(id), { ok: false as const, reason: NI });
    ids[i] = 0;
  }
  plan.status = 'failed';
  void spec;
}

// ---------------------------------------------------------------- finances
function manageFinances(ctx: GameContext, c: Company, res: ThinkResult): void {
  const pers = PERSONALITIES[c.ai!.personality];
  const E = ctx.services.economy;
  const debt = outstandingDebt(c);
  const expenses = monthlyExpenses(c);
  // Repay when rich (cautious repays early).
  if (c.loans.length && c.cash > expenses * (pers.loanAppetite < 0.3 ? 4 : 10) + 20000) {
    const loan = c.loans[0]!;
    const amount = Math.min(loan.remaining, c.cash - expenses * 3);
    if (amount > 0) {
      const r = safe(() => E.repayLoan(c.id, loan.id, amount), { ok: false as const, reason: NI });
      if (r.ok) res.actions++;
    }
  }
  // Borrow: for expansion (appetite) or survival (cash below 1 month of expenses while operating profitably-ish).
  const limit = Math.max(0, c.creditLimit - debt);
  if (limit < 5000) return;
  const profit = recentProfit(c);
  const lowCash = c.cash < expenses;
  const wantsExpansion = pers.loanAppetite >= 0.5 && c.cash < 60000 && profit > 0;
  if (!(lowCash && (profit > -expenses * 0.5 || pers.loanAppetite >= 0.5)) && !wantsExpansion) return;
  if (c.loans.length >= 3) return;
  const amount = Math.round(Math.min(limit * pers.loanAppetite, Math.max(10000, expenses * 6)) / 1000) * 1000;
  if (amount < 5000) return;
  const r = safe(() => E.takeLoan(c.id, amount, 60), { ok: false as const, reason: NI });
  if (r.ok) res.actions++;
}

function handleDistress(ctx: GameContext, c: Company, res: ThinkResult): void {
  const state = ctx.state;
  const m = mem(c.ai!);
  if (c.cash >= 0) {
    m.distressSince = 0;
    return;
  }
  if (!num(m.distressSince)) m.distressSince = state.time.totalDays;
  // 1) sell idle / broken-path vehicles
  for (const v of Object.values(state.vehicles)) {
    if (v.owner !== c.id || (v.status !== 'idle' && v.status !== 'noPath')) continue;
    const r = safe(() => ctx.services.logistics.sellVehicle(v.id), { ok: false as const, reason: NI });
    if (r.ok) res.actions++;
  }
  // 2) after 3 months in the red, demolish the worst building
  if (state.time.totalDays - num(m.distressSince) > 90) {
    let worst: Building | null = null;
    let worstP = Infinity;
    for (const b of companyBuildings(state, c.id)) {
      const p = b.stats.profitHistory.slice(-3).reduce((s, v) => s + v, 0);
      if (p < worstP) {
        worstP = p;
        worst = b;
      }
    }
    if (worst && worstP < 0) {
      const r = safe(() => ctx.services.economy.demolish(worst!.id), { ok: false as const, reason: NI });
      if (r.ok) res.actions++;
    }
  }
  // 3) fallback bankruptcy (if economy doesn't handle it): 1 year deep in the red
  if (!c.bankrupt && state.time.totalDays - num(m.distressSince) > 360 && c.cash < -Math.max(20000, c.creditLimit * 0.5)) {
    c.bankrupt = true;
    ctx.bus.emit('company:bankrupt', { companyId: c.id });
  }
}

// ---------------------------------------------------------------- research
function manageResearch(ctx: GameContext, c: Company, res: ThinkResult): void {
  const pers = PERSONALITIES[c.ai!.personality];
  const rs = c.research;
  if (rs.current) return;
  if (c.cash < 15000 * (1.5 - pers.research)) return;
  const eraIdx = ctx.data.eraIndex(ctx.state.time.eraId);
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const t of ctx.data.techList()) {
    if (rs.unlocked[t.id] !== undefined) continue;
    if (!t.prereqs.every((p) => rs.unlocked[p] !== undefined)) continue;
    if (ctx.data.eraIndex(t.era) > eraIdx) continue;
    let score = -t.cost / 100;
    for (const e of t.effects) {
      if (e.kind === 'modifier') score += e.key.startsWith('efficiency') ? 3 : e.key.startsWith('emissions') ? 2 * pers.green : 1;
      else if (e.kind === 'unlockBuilding' || e.kind === 'unlockRecipe') score += 2;
      else if (e.kind === 'unlockVehicle') score += 1.5;
    }
    if (score > bestScore) {
      bestScore = score;
      best = t.id;
    }
  }
  if (!best) return;
  const r = safe(() => ctx.services.economy.startResearch(c.id, best!), { ok: false as const, reason: NI });
  if (r.ok) {
    res.actions++;
    if (!rs.budget) rs.budget = Math.round(Math.min(5000, Math.max(500, c.cash * 0.01 * (0.5 + pers.research))));
  }
}

// ---------------------------------------------------------------- expansion
function activeProjects(ai: AIState): number {
  return ai.plans.filter((p) => p.kind === 'chain' && (p.status === 'pending' || p.status === 'active')).length;
}

function busyProjects(ai: AIState): number {
  return ai.plans.filter((p) => p.kind === 'chain' && p.status === 'pending').length;
}

function considerNewProject(ctx: GameContext, c: Company, r: Rng, res: ThinkResult): void {
  const ai = c.ai!;
  const state = ctx.state;
  const pers = PERSONALITIES[ai.personality];
  const diff = DIFFICULTY[ai.difficulty];
  if (busyProjects(ai) > 0) return; // finish what we started first
  const maxProjects = Math.max(1, diff.projects + pers.extraProjects) + Math.floor((state.time.totalDays - c.foundedDay) / 720);
  if (activeProjects(ai) >= maxProjects) return;
  // Don't expand while the company is losing money (except aggressive).
  const profit = recentProfit(c);
  if (activeProjects(ai) > 0 && profit < 0 && ai.personality !== 'aggressive') return;

  const best = pickProject(ctx, c, r);
  if (!best) return;
  const reserve = Math.max(3000, c.cash * pers.reserve);
  if (c.cash - reserve < best.capital) return;

  const spec = flattenChain(best);
  const plan: AIPlan = {
    id: (num(mem(ai).planSeq) || 0) + 1,
    kind: 'chain',
    status: 'pending',
    params: {
      product: best.productId,
      city: best.cityId,
      spec: JSON.stringify(spec),
      ids: spec.map(() => 0),
      linked: spec.map((_, i) => (i === 0 ? 1 : 0)),
      routes: spec.map(() => 0),
      est: Math.round(best.profit),
      capital: Math.round(best.capital),
      tries: 0,
    },
    createdDay: state.time.totalDays,
  };
  mem(ai).planSeq = plan.id;
  if (!ai.focusProducts.includes(best.productId)) ai.focusProducts.push(best.productId);
  ai.plans.push(plan);
  res.actions++;
  // Start building right away.
  const ids = arr(plan, 'ids', spec.length);
  if (!buildMissing(ctx, c, plan, spec, ids, res) && ids.every((id) => !id)) {
    // Could not place even the shop: drop the plan, remember the city/product as bad for a while.
    plan.status = 'failed';
    mem(ai)[`bad:${best.productId}:${best.cityId}`] = state.time.totalDays;
  } else {
    maintainPlans(ctx, c, res);
  }
}

/** Evaluate candidate (product, city) pairs and return the best estimate. */
export function pickProject(ctx: GameContext, c: Company, r: Rng): ChainEstimate | null {
  const ai = c.ai!;
  const state = ctx.state;
  const pers = PERSONALITIES[ai.personality];
  const diff = DIFFICULTY[ai.difficulty];
  const home = c.hq ?? { x: state.map.width / 2, y: state.map.height / 2 };
  const maxDist = Math.hypot(state.map.width, state.map.height);
  let best: ChainEstimate | null = null;
  let bestScore = -Infinity;
  const products = consumerProducts(ctx).filter((p) => {
    try {
      return ctx.services.economy.isUnlocked(c.id, 'product', p);
    } catch {
      return false;
    }
  });
  const existing = new Set(ai.plans.filter((p) => p.status !== 'failed').map((p) => `${p.params.product}:${p.params.city}`));
  for (const productId of products) {
    const cities = citiesByOpportunity(ctx, c.id, productId).slice(0, 4);
    for (const { city } of cities) {
      if (existing.has(`${productId}:${city.id}`)) continue;
      const bad = num(mem(ai)[`bad:${productId}:${city.id}`], -1e9);
      if (state.time.totalDays - bad < 360) continue;
      const est = estimateChain(ctx, c.id, productId, city, { balance: diff.balanceChains, maxBuildings: diff.maxChainBuildings + (pers.depthBias > 0.2 ? 2 : 0) });
      if (!est || est.profit <= 0) continue;
      const roi = est.roi;
      if (roi < pers.minRoi) continue;
      const product = ctx.data.products[productId];
      let score = roi * 100;
      score *= 1 + pers.depthBias * est.buildingCount * 0.1;
      score *= 1 + pers.competeBias * rivalShare(city, productId, c.id);
      if (product?.green) score *= 1 + pers.green * 0.5;
      score *= 1 - (0.5 * dist(home.x, home.y, city.x, city.y)) / maxDist; // prefer home region
      score *= Math.max(0.2, 1 + r.normal() * diff.noise);
      if (score > bestScore) {
        bestScore = score;
        best = est;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------- bankruptcy
/** Sell vehicles and routes, offer buildings for sale; demolish unsold ones after 6 months. */
export function liquidate(ctx: GameContext, c: Company): void {
  const state = ctx.state;
  const m = mem(c.ai!);
  if (!m.liquidated) {
    m.liquidated = true;
    m.saleUntil = state.time.totalDays + 180;
    for (const v of Object.values(state.vehicles))
      if (v.owner === c.id) safe(() => ctx.services.logistics.sellVehicle(v.id), { ok: false as const, reason: NI });
    for (const route of Object.values(state.routes)) if (route.owner === c.id) safe(() => ctx.services.logistics.removeRoute(route.id), false);
    for (const p of c.ai!.plans) if (p.status !== 'done') p.status = 'failed';
    const n = companyBuildings(state, c.id).length;
    notify(ctx, {
      level: 'info',
      icon: c.logo,
      title: `${c.name} zbankrutowała`,
      text: n
        ? `Firma wyprzedaje majątek: ${n} budynków można przejąć za pół ceny (inspektor budynku → Przejmij).`
        : 'Firma zniknęła z rynku.',
      target: { kind: 'company', id: c.id },
      category: 'ai',
      companyId: 0,
    });
    return;
  }
  if (state.time.totalDays >= num(m.saleUntil)) {
    for (const b of companyBuildings(state, c.id)) safe(() => ctx.services.economy.demolish(b.id), { ok: false as const, reason: NI });
  }
}

// ---------------------------------------------------------------- utilities for other modules
/** Short status summary of an AI company (for panels / advisor). */
export function aiSummary(ctx: GameContext, c: Company): { buildings: number; vehicles: number; chains: number; focus: string[] } {
  const state = ctx.state;
  let vehicles = 0;
  for (const v of Object.values(state.vehicles)) if (v.owner === c.id) vehicles++;
  return {
    buildings: companyBuildings(state, c.id).length,
    vehicles,
    chains: c.ai ? activeProjects(c.ai) : 0,
    focus: c.ai?.focusProducts.map((p) => ctx.data.products[p]?.name ?? p) ?? [],
  };
}

