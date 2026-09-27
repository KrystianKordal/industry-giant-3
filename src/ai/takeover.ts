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
import type { Building, BuildingId, CompanyId, Stock } from '../core/types';
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

export function createAiService(ctx: GameContext): AiService {
  return {
    buildingPrice: (buyerId, buildingId) => buildingPrice(ctx, buyerId, buildingId),
    buyBuilding: (buyerId, buildingId) => buyBuilding(ctx, buyerId, buildingId),
  };
}
