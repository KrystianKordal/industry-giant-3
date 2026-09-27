/**
 * Building takeovers (acquisitions). Exposed as ctx.services.ai:
 *   buildingPrice(buyerId, buildingId) → asking price | null
 *   buyBuilding(buyerId, buildingId)   → ActionResult
 *
 * Pricing: book value (cost × condition) + goodwill (12 × avg positive monthly
 * profit) + stock value; × seller premium (AI personality). Bankrupt sellers
 * sell at 50% of book value + stock. The player's own buildings are never for
 * sale to AI. Money moves only through core/money.ts addMoney.
 */
import type { GameContext } from '../core/context';
import { addMoney } from '../core/money';
import { notify } from '../core/notify';
import type { AiService, ActionResult } from '../core/services';
import type { Building, BuildingId, Company, CompanyId, Stock } from '../core/types';
import { PERSONALITIES } from './profiles';

function stockValue(ctx: GameContext, s: Stock): number {
  let v = 0;
  for (const [pid, e] of Object.entries(s)) {
    let price = ctx.data.products[pid]?.basePrice ?? 0;
    try {
      price = ctx.services.economy.price(pid) || price;
    } catch {
      /* base price */
    }
    v += e.qty * price;
  }
  return v;
}

/** Book value + goodwill + goods (without seller premium). */
export function buildingValue(ctx: GameContext, b: Building): number {
  const def = ctx.data.buildings[b.typeId];
  const cost = (def?.cost ?? 0) * Math.max(1, b.level);
  let upgrades = 0;
  for (const u of b.upgrades) upgrades += def?.upgrades?.find((d) => d.id === u)?.cost ?? 0;
  const book = (cost + upgrades) * (0.4 + 0.6 * Math.max(0, Math.min(1, b.condition)));
  const hist = b.stats.profitHistory.slice(-6);
  const avg = hist.length ? hist.reduce((s, v) => s + v, 0) / hist.length : 0;
  const goodwill = Math.max(0, avg) * 12;
  return Math.round(book + goodwill + stockValue(ctx, b.input) + stockValue(ctx, b.output) + stockValue(ctx, b.storage));
}

export function buildingPrice(ctx: GameContext, buyerId: CompanyId, buildingId: BuildingId): number | null {
  const state = ctx.tryState();
  if (!state) return null;
  const b = state.buildings[buildingId];
  if (!b || !b.owner || b.owner === buyerId) return null;
  const seller = state.companies[b.owner];
  if (!seller) return null;
  if (seller.isPlayer) return null; // player assets are never sold automatically
  const def = ctx.data.buildings[b.typeId];
  if (!def) return null;
  if (seller.bankrupt) {
    const bookOnly = (def.cost * (0.4 + 0.6 * b.condition)) * 0.5;
    return Math.round(bookOnly + stockValue(ctx, b.output) + stockValue(ctx, b.input) + stockValue(ctx, b.storage));
  }
  const pers = seller.ai ? PERSONALITIES[seller.ai.personality] : null;
  // Aggressive companies defend their assets, cautious ones sell more readily.
  const premium = pers ? 1.3 + pers.loanAppetite * 0.2 - (pers.id === 'cautious' ? 0.1 : 0) : 1.5;
  return Math.round(buildingValue(ctx, b) * premium);
}

export function buyBuilding(ctx: GameContext, buyerId: CompanyId, buildingId: BuildingId): ActionResult {
  const state = ctx.tryState();
  if (!state) return { ok: false, reason: 'Brak gry' };
  const b = state.buildings[buildingId];
  if (!b) return { ok: false, reason: 'Brak budynku' };
  const buyer = state.companies[buyerId];
  if (!buyer || buyer.bankrupt) return { ok: false, reason: 'Nieprawidłowy kupujący' };
  if (b.owner === buyerId) return { ok: false, reason: 'To już twój budynek' };
  const price = buildingPrice(ctx, buyerId, buildingId);
  if (price === null) return { ok: false, reason: 'Ten budynek nie jest na sprzedaż' };
  if (buyer.cash < price) return { ok: false, reason: 'Brak środków' };
  const sellerId = b.owner;
  const seller = state.companies[sellerId];

  // Seller's routes touching this building are closed (vehicles go idle / are re-planned by the AI).
  for (const route of Object.values(state.routes)) {
    if (route.owner !== sellerId || !route.stops.some((s) => s.buildingId === buildingId)) continue;
    try {
      const removed = ctx.services.logistics.removeRoute(route.id);
      if (!removed) route.enabled = false;
    } catch {
      route.enabled = false;
    }
  }

  addMoney(ctx, buyerId, -price, 'construction');
  addMoney(ctx, sellerId, price, 'assetSale');
  b.owner = buyerId;
  if (b.shop) b.shop.priceFactor = 1;
  ctx.bus.emit('building:changed', { buildingId });
  ctx.bus.emit('map:changed', { x: b.x, y: b.y, w: b.w, h: b.h });
  ctx.bus.emit('sfx', { id: 'cash', x: b.x, y: b.y });
  const name = ctx.data.buildings[b.typeId]?.name ?? b.typeId;
  if (buyerId === state.playerCompanyId) {
    notify(ctx, {
      level: 'success',
      icon: '🤝',
      title: 'Przejęcie zakończone',
      text: `Kupiono ${name} od ${seller?.name ?? 'rywala'} za ${Math.round(price).toLocaleString('pl-PL')} zł.`,
      target: { kind: 'building', id: buildingId },
      category: 'ai',
      companyId: 0,
    });
  }
  return { ok: true, cost: price };
}

// ============================================================================
// Hostile takeover of a whole company (late-game money sink)
// ============================================================================

/** Minimum takeover price (tiny / fresh rivals). */
export const COMPANY_TAKEOVER_MIN = 250_000;

export interface CompanyTakeoverQuote {
  price: number;
  /** Valuation used as the base (cash + assets − debt + goodwill, or asset floor). */
  base: number;
  premium: number;
  cash: number;
  debt: number;
  buildings: number;
  vehicles: number;
  routes: number;
  /** Why a takeover is impossible (null = possible if the buyer can pay). */
  blocked: string | null;
}

const debtOfCompany = (c: Company): number => c.loans.reduce((s, l) => s + l.remaining, 0);

function valueOf(ctx: GameContext, id: CompanyId): number {
  try {
    const v = ctx.services.economy.companyValue(id);
    if (Number.isFinite(v)) return v;
  } catch {
    /* fallback below */
  }
  return ctx.state.companies[id]?.finances.valuation ?? 0;
}

/**
 * Quote for taking over `targetId`: max(valuation, 25% of assets, minimum) ×
 * premium. Premium 1.5 base, +0.2 × (reputation − 50) / 50, +0.25 when the
 * target is worth more than the buyer, +0.1 for aggressive AI (defends itself),
 * −0.1 for cautious AI.
 */
export function companyTakeoverQuote(ctx: GameContext, buyerId: CompanyId, targetId: CompanyId): CompanyTakeoverQuote | null {
  const state = ctx.tryState();
  if (!state) return null;
  const buyer = state.companies[buyerId];
  const target = state.companies[targetId];
  if (!buyer || !target) return null;
  let buildings = 0;
  let vehicles = 0;
  let routes = 0;
  for (const b of Object.values(state.buildings)) if (b.owner === targetId) buildings++;
  for (const v of Object.values(state.vehicles)) if (v.owner === targetId) vehicles++;
  for (const r of Object.values(state.routes)) if (r.owner === targetId) routes++;
  const debt = debtOfCompany(target);
  const value = valueOf(ctx, targetId);
  const assets = Math.max(0, value - target.cash + debt);
  const base = Math.max(COMPANY_TAKEOVER_MIN, value, assets * 0.25);
  let premium = 1.5 + (0.2 * (Math.max(0, Math.min(100, target.reputation)) - 50)) / 50;
  if (value > valueOf(ctx, buyerId)) premium += 0.25;
  if (target.ai?.personality === 'aggressive') premium += 0.1;
  if (target.ai?.personality === 'cautious') premium -= 0.1;
  premium = Math.round(premium * 100) / 100;
  let blocked: string | null = null;
  if (targetId === buyerId) blocked = 'To Twoja firma';
  else if (target.isPlayer) blocked = 'Firmy gracza nie można przejąć';
  else if (target.acquiredBy) blocked = 'Firma została już przejęta';
  else if (target.bankrupt) blocked = 'Firma jest w upadłości — przejmij jej budynki pojedynczo za pół ceny';
  else if (buyer.bankrupt) blocked = 'Twoja firma jest bankrutem';
  else if (state.time.totalDays - target.foundedDay < 360) blocked = 'Firmę można przejąć najwcześniej rok po jej założeniu';
  return { price: Math.round(base * premium), base: Math.round(base), premium, cash: Math.round(target.cash), debt: Math.round(debt), buildings, vehicles, routes, blocked };
}

export function companyPrice(ctx: GameContext, buyerId: CompanyId, targetId: CompanyId): number | null {
  const q = companyTakeoverQuote(ctx, buyerId, targetId);
  return q && !q.blocked ? q.price : null;
}

/**
 * Take over a whole company: the buyer pays the price (ledger 'acquisition'),
 * takes over its cash and loans, and becomes the owner of all its buildings,
 * vehicles, routes and road/rail tiles. The target keeps its record (history)
 * with `bankrupt = true`, `acquiredBy = buyer` and stops acting.
 */
export function buyCompany(ctx: GameContext, buyerId: CompanyId, targetId: CompanyId): ActionResult {
  const state = ctx.tryState();
  if (!state) return { ok: false, reason: 'Brak gry' };
  const q = companyTakeoverQuote(ctx, buyerId, targetId);
  if (!q) return { ok: false, reason: 'Nieznana firma' };
  if (q.blocked) return { ok: false, reason: q.blocked };
  const buyer = state.companies[buyerId]!;
  const target = state.companies[targetId]!;
  if (buyer.cash < q.price) return { ok: false, reason: `Brak środków (potrzeba ${Math.round(q.price).toLocaleString('pl-PL')} zł)` };

  // money: price to the old shareholders (leaves the economy), cash & debt move to the buyer
  addMoney(ctx, buyerId, -q.price, 'acquisition');
  const cash = target.cash;
  if (cash !== 0) {
    addMoney(ctx, targetId, -cash, 'acquisition');
    addMoney(ctx, buyerId, cash, 'acquisition');
  }
  if (target.loans.length) {
    buyer.loans.push(...target.loans);
    target.loans = [];
  }

  // assets
  const W = state.map.width;
  for (const b of Object.values(state.buildings)) {
    if (b.owner !== targetId) continue;
    b.owner = buyerId;
    if (b.shop) b.shop.priceFactor = 1;
    ctx.bus.emit('building:changed', { buildingId: b.id });
    ctx.bus.emit('map:changed', { x: b.x, y: b.y, w: b.w, h: b.h });
  }
  for (const v of Object.values(state.vehicles)) if (v.owner === targetId) v.owner = buyerId;
  for (const r of Object.values(state.routes)) {
    if (r.owner !== targetId) continue;
    r.owner = buyerId;
    ctx.bus.emit('route:changed', { routeId: r.id });
  }
  const net = state.network;
  const roadTiles: number[] = [];
  const railTiles: number[] = [];
  for (let i = 0; i < net.owner.length; i++) {
    if (net.owner[i] !== targetId) continue;
    net.owner[i] = buyerId;
    if (net.road[i]) roadTiles.push(i);
    if (net.rail[i]) railTiles.push(i);
  }
  if (roadTiles.length || railTiles.length) {
    net.version++;
    if (roadTiles.length) ctx.bus.emit('network:changed', { kind: 'road', tiles: roadTiles });
    if (railTiles.length) ctx.bus.emit('network:changed', { kind: 'rail', tiles: railTiles });
    const all = [...roadTiles, ...railTiles];
    let x0 = W;
    let y0 = state.map.height;
    let x1 = 0;
    let y1 = 0;
    for (const i of all) {
      const x = i % W;
      const y = (i - x) / W;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    ctx.bus.emit('map:changed', { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }

  // the target stops existing as an actor
  target.bankrupt = true;
  target.acquiredBy = buyerId;
  target.acquiredDay = state.time.totalDays;
  target.monthsInDebt = 0;
  target.creditLimit = 0;
  if (target.ai) {
    for (const p of target.ai.plans) if (p.status !== 'done') p.status = 'failed';
    target.ai.memory.liquidated = true; // never run the bankruptcy liquidation for it
  }

  ctx.bus.emit('sfx', { id: 'victory' });
  if (buyerId === state.playerCompanyId || target.isPlayer) {
    notify(ctx, {
      level: 'success',
      icon: '🦈',
      title: `Przejęto firmę ${target.name}`,
      text: `Za ${Math.round(q.price).toLocaleString('pl-PL')} zł przejmujesz ${q.buildings} budynków, ${q.vehicles} pojazdów i ${q.routes} tras` +
        `${cash ? ` oraz ${Math.round(cash).toLocaleString('pl-PL')} zł gotówki` : ''}${q.debt ? ` (i ${Math.round(q.debt).toLocaleString('pl-PL')} zł kredytów)` : ''}.`,
      target: { kind: 'company', id: buyerId },
      category: 'ai',
      companyId: 0,
    });
  }
  return { ok: true, cost: q.price };
}

export function createAiService(ctx: GameContext): AiService {
  return {
    buildingPrice: (buyerId, buildingId) => buildingPrice(ctx, buyerId, buildingId),
    buyBuilding: (buyerId, buildingId) => buyBuilding(ctx, buyerId, buildingId),
    companyPrice: (buyerId, targetId) => companyPrice(ctx, buyerId, targetId),
    buyCompany: (buyerId, targetId) => buyCompany(ctx, buyerId, targetId),
  };
}
