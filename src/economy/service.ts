/**
 * EconomyService implementation (ctx.services.economy). AI and UI build,
 * research, borrow and tweak buildings ONLY through these methods.
 */
import type { GameContext } from '../core/context';
import { addBuilding, checkPlacement as coreCheckPlacement, createBuildingRecord, footprintSize, removeBuilding, type PlaceCheck } from '../core/entities';
import { addMoney } from '../core/money';
import type { ActionResult, EconomyService } from '../core/services';
import { Terrain, type Building, type BuildingId, type City, type CompanyId, type ProductId } from '../core/types';
import { addStock, clamp, forEachTileInRect, takeStock } from '../core/util';
import type { BuildingDef } from '../data/defs';
import { DEMOLISH_REFUND, DEMOLISH_REFUND_CONSTRUCTION, REPAIR_COST_FACTOR } from './constants';
import { computeValuation, repayLoan, takeLoan } from './finance';
import { setStatus } from './production';
import { cancelResearch, queueResearch, startResearch } from './research';
import { companyEraIndex, isUnlockedFor } from './unlocks';

/** Cities whose area (radius + 2) contains the footprint center. */
function citiesAround(ctx: GameContext, def: BuildingDef, x: number, y: number, rot: number): City[] {
  const { w, h } = footprintSize(def, rot);
  const cx = x + w / 2;
  const cy = y + h / 2;
  return Object.values(ctx.state.cities).filter((c) => Math.hypot(cx - c.x, cy - c.y) <= c.radius + 2);
}

export function checkPlacement(ctx: GameContext, companyId: CompanyId, typeId: string, x: number, y: number, rot: 0 | 1 | 2 | 3): PlaceCheck {
  const state = ctx.state;
  const def = ctx.data.buildings[typeId];
  if (!def) return { ok: false, reason: 'Nieznany typ budynku', cost: 0 };
  const company = state.companies[companyId];
  if (company?.bankrupt) return { ok: false, reason: 'Firma jest bankrutem', cost: 0 };
  if (companyId && !isUnlockedFor(state, ctx.data, company, 'building', typeId)) {
    const eraOk = ctx.data.eraIndex(def.era) <= companyEraIndex(state, ctx.data, company);
    const reason = !eraOk
      ? `Dostępne w epoce: ${ctx.data.eras[def.era]?.name ?? def.era}`
      : `Wymaga technologii: ${ctx.data.techs[def.requiresTech ?? '']?.name ?? def.requiresTech}`;
    return { ok: false, reason, cost: def.cost };
  }
  if (def.category === 'hq' && companyId && Object.values(state.buildings).some((b) => b.owner === companyId && b.typeId === typeId))
    return { ok: false, reason: 'Firma ma już siedzibę', cost: def.cost };
  const chk = coreCheckPlacement(state, ctx.data, companyId, typeId, x, y, rot);
  if (!chk.ok) return chk;
  if (companyId) {
    for (const city of citiesAround(ctx, def, x, y, rot)) {
      const permit = city.permits[companyId] ?? 'granted';
      if (permit === 'denied') return { ok: false, reason: `${city.name} odmawia pozwolenia na budowę`, cost: chk.cost };
      if (permit === 'restricted' && def.pollution > 2)
        return { ok: false, reason: `${city.name}: pozwolenie tylko na nieuciążliwe budynki`, cost: chk.cost };
    }
  }
  return chk;
}

function build(ctx: GameContext, companyId: CompanyId, typeId: string, x: number, y: number, rot: 0 | 1 | 2 | 3): ActionResult<{ id: BuildingId }> {
  const chk = checkPlacement(ctx, companyId, typeId, x, y, rot);
  if (!chk.ok) return { ok: false, reason: chk.reason ?? 'Nie można budować' };
  const state = ctx.state;
  const def = ctx.data.building(typeId);
  const b = createBuildingRecord(state, ctx.data, typeId, companyId, x, y, rot);
  // pick the first unlocked recipe as default
  const company = state.companies[companyId];
  const firstOk = def.recipes.find((r) => !companyId || isUnlockedFor(state, ctx.data, company, 'recipe', r));
  b.recipeId = firstOk ?? def.recipes[0] ?? null;
  const near = ctx.services.world.nearestCity(b.x + b.w / 2, b.y + b.h / 2, 40);
  b.cityId = near || 0;
  addBuilding(state, b);
  // site: farms cultivate the land, other buildings clear trees
  const map = state.map;
  const isFarm = def.tags?.includes('farm');
  const isForestry = def.tags?.includes('forestry');
  forEachTileInRect(map, b.x, b.y, b.w, b.h, (i) => {
    if (isFarm && map.terrain[i] === Terrain.Grass) map.terrain[i] = Terrain.Farmland;
    if (!isForestry) map.forest[i] = 0;
  });
  if (def.category === 'hq' && company) company.hq = { x: b.x, y: b.y };
  if (chk.cost > 0) addMoney(ctx, companyId, -chk.cost, 'construction');
  ctx.bus.emit('building:built', { buildingId: b.id });
  ctx.bus.emit('map:changed', { x: b.x, y: b.y, w: b.w, h: b.h });
  ctx.bus.emit('sfx', { id: 'build', x, y });
  return { ok: true, cost: chk.cost, id: b.id };
}

function demolish(ctx: GameContext, buildingId: BuildingId): ActionResult {
  const state = ctx.state;
  const b = state.buildings[buildingId];
  if (!b) return { ok: false, reason: 'Brak budynku' };
  const def = ctx.data.buildings[b.typeId];
  const cost = def?.cost ?? 0;
  const refund = Math.round(cost * (b.constructionProgress < 1 ? DEMOLISH_REFUND_CONSTRUCTION * (1 - b.constructionProgress * 0.5) : DEMOLISH_REFUND * b.condition));
  removeBuilding(state, buildingId);
  if (b.owner && refund > 0) addMoney(ctx, b.owner, refund, 'assetSale');
  const company = state.companies[b.owner];
  if (def?.category === 'hq' && company) company.hq = null;
  ctx.bus.emit('building:removed', { buildingId, typeId: b.typeId, owner: b.owner, x: b.x, y: b.y, w: b.w, h: b.h });
  ctx.bus.emit('map:changed', { x: b.x, y: b.y, w: b.w, h: b.h });
  ctx.bus.emit('sfx', { id: 'demolish', x: b.x, y: b.y });
  return { ok: true, cost: -refund };
}

function setRecipe(ctx: GameContext, buildingId: BuildingId, recipeId: string): boolean {
  const state = ctx.state;
  const b = state.buildings[buildingId];
  const def = b ? ctx.data.buildings[b.typeId] : undefined;
  if (!b || !def || !def.recipes.includes(recipeId)) return false;
  if (b.owner && !isUnlockedFor(state, ctx.data, state.companies[b.owner], 'recipe', recipeId)) return false;
  if (b.recipeId === recipeId) return true;
  const r = ctx.data.recipes[recipeId];
  if (!r) return false;
  // inputs the new recipe does not use go to the output buffer so they can be hauled away
  const needed = new Set(r.inputs.map((i) => i.product));
  for (const p of Object.keys(b.input)) {
    if (needed.has(p)) continue;
    const t = takeStock(b.input, p, b.input[p]!.qty);
    addStock(b.output, p, t.qty, t.quality);
  }
  b.recipeId = recipeId;
  b.progress = 0;
  ctx.bus.emit('building:changed', { buildingId });
  return true;
}

function price(ctx: GameContext, productId: ProductId, cityId?: number): number {
  const state = ctx.state;
  if (cityId) {
    const d = state.cities[cityId]?.demand[productId];
    if (d && d.price > 0 && Number.isFinite(d.price)) return d.price;
  }
  const p = state.market.products[productId]?.price;
  return p !== undefined && Number.isFinite(p) ? p : (ctx.data.products[productId]?.basePrice ?? 0);
}

let acquiring = false;
function acquireBuilding(ctx: GameContext, companyId: CompanyId, buildingId: BuildingId): ActionResult {
  // Pricing/transfer rules live in the AI module (services.ai.buyBuilding); delegate when available.
  if (!acquiring) {
    acquiring = true;
    try {
      const res = ctx.services.ai.buyBuilding(companyId, buildingId);
      if (res.ok || res.reason !== 'Niezaimplementowane') return res;
    } finally {
      acquiring = false;
    }
  }
  const state = ctx.state;
  const b = state.buildings[buildingId];
  const buyer = state.companies[companyId];
  if (!b || !buyer) return { ok: false, reason: 'Brak budynku' };
  if (b.owner === companyId) return { ok: false, reason: 'To już twój budynek' };
  const seller = state.companies[b.owner];
  if (!seller) return { ok: false, reason: 'Ten budynek nie jest na sprzedaż' };
  if (seller.isPlayer && !buyer.isPlayer) return { ok: false, reason: 'Ten budynek nie jest na sprzedaż' };
  const def = ctx.data.buildings[b.typeId];
  const book = (def?.cost ?? 0) * (0.4 + 0.6 * b.condition);
  const cost = Math.round(book * (seller.bankrupt ? 0.5 : 1.5));
  if (buyer.cash < cost) return { ok: false, reason: 'Brak środków' };
  addMoney(ctx, companyId, -cost, 'construction');
  addMoney(ctx, b.owner, cost, 'assetSale');
  b.owner = companyId;
  if (b.shop) b.shop.priceFactor = 1;
  ctx.bus.emit('building:changed', { buildingId });
  ctx.bus.emit('map:changed', { x: b.x, y: b.y, w: b.w, h: b.h });
  return { ok: true, cost };
}

function setBuildingEnabled(ctx: GameContext, buildingId: BuildingId, enabled: boolean): boolean {
  const b = ctx.state.buildings[buildingId];
  if (!b) return false;
  if (b.enabled === enabled) return true;
  b.enabled = enabled;
  if (!enabled) setStatus(ctx, b, 'disabled');
  ctx.bus.emit('building:changed', { buildingId });
  return true;
}

function upgradeBuilding(ctx: GameContext, buildingId: BuildingId, upgradeId: string): ActionResult {
  const state = ctx.state;
  const b = state.buildings[buildingId];
  const def = b ? ctx.data.buildings[b.typeId] : undefined;
  if (!b || !def) return { ok: false, reason: 'Brak budynku' };
  if (b.constructionProgress < 1) return { ok: false, reason: 'Budynek jest w budowie' };
  const u = def.upgrades?.find((x) => x.id === upgradeId);
  if (!u) return { ok: false, reason: 'Nieznane ulepszenie' };
  if (b.upgrades.includes(upgradeId)) return { ok: false, reason: 'Ulepszenie już zainstalowane' };
  const company = state.companies[b.owner];
  if (u.requiresTech && company && company.research.unlocked[u.requiresTech] === undefined)
    return { ok: false, reason: `Wymaga technologii: ${ctx.data.techs[u.requiresTech]?.name ?? u.requiresTech}` };
  if (!company || company.cash < u.cost) return { ok: false, reason: 'Brak środków' };
  addMoney(ctx, b.owner, -u.cost, 'construction');
  b.upgrades.push(upgradeId);
  b.level = 1 + b.upgrades.length;
  ctx.bus.emit('building:changed', { buildingId });
  ctx.bus.emit('sfx', { id: 'build', x: b.x, y: b.y });
  return { ok: true, cost: u.cost };
}

function setShopPrice(ctx: GameContext, buildingId: BuildingId, factor: number): boolean {
  const b = ctx.state.buildings[buildingId];
  if (!b?.shop || !Number.isFinite(factor)) return false;
  b.shop.priceFactor = Math.round(clamp(factor, 0.5, 2) * 100) / 100;
  ctx.bus.emit('building:changed', { buildingId });
  return true;
}

function setResearchBudget(ctx: GameContext, companyId: CompanyId, amount: number): boolean {
  const c = ctx.state.companies[companyId];
  if (!c || !Number.isFinite(amount)) return false;
  c.research.budget = Math.max(0, Math.round(amount));
  return true;
}

export function repairCost(ctx: GameContext, b: Building): number {
  const def = ctx.data.buildings[b.typeId];
  return Math.round((1 - clamp(b.condition, 0, 1)) * (def?.cost ?? 0) * REPAIR_COST_FACTOR);
}

function repairBuilding(ctx: GameContext, buildingId: BuildingId): ActionResult {
  const b = ctx.state.buildings[buildingId];
  if (!b) return { ok: false, reason: 'Brak budynku' };
  const cost = repairCost(ctx, b);
  if (cost <= 0) return { ok: true, cost: 0 };
  const c = ctx.state.companies[b.owner];
  if (!c || c.cash < cost) return { ok: false, reason: 'Brak środków' };
  addMoney(ctx, b.owner, -cost, 'otherExpense');
  b.condition = 1;
  ctx.bus.emit('building:changed', { buildingId });
  return { ok: true, cost };
}

export function createEconomyService(ctx: GameContext): EconomyService {
  return {
    checkPlacement: (companyId, typeId, x, y, rot) => checkPlacement(ctx, companyId, typeId, x, y, rot),
    build: (companyId, typeId, x, y, rot) => build(ctx, companyId, typeId, x, y, rot),
    demolish: (id) => demolish(ctx, id),
    setRecipe: (id, recipeId) => setRecipe(ctx, id, recipeId),
    price: (productId, cityId) => price(ctx, productId, cityId),
    isUnlocked: (companyId, kind, id) => isUnlockedFor(ctx.state, ctx.data, ctx.state.companies[companyId], kind, id),
    startResearch: (companyId, techId) => startResearch(ctx, companyId, techId),
    takeLoan: (companyId, amount, term) => takeLoan(ctx, companyId, amount, term),
    repayLoan: (companyId, loanId, amount) => repayLoan(ctx, companyId, loanId, amount),
    companyValue: (companyId) => {
      const c = ctx.state.companies[companyId];
      return c ? computeValuation(ctx, c) : 0;
    },
    acquireBuilding: (companyId, buildingId) => acquireBuilding(ctx, companyId, buildingId),
    setBuildingEnabled: (id, enabled) => setBuildingEnabled(ctx, id, enabled),
    upgradeBuilding: (id, upgradeId) => upgradeBuilding(ctx, id, upgradeId),
    setShopPrice: (id, f) => setShopPrice(ctx, id, f),
    setResearchBudget: (companyId, amount) => setResearchBudget(ctx, companyId, amount),
    queueResearch: (companyId, techId) => queueResearch(ctx, companyId, techId),
    cancelResearch: (companyId) => {
      cancelResearch(ctx, companyId);
      return true;
    },
    repairBuilding: (id) => repairBuilding(ctx, id),
  };
}
