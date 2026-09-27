/**
 * Entity factories + low-level invariant-keeping helpers.
 *
 * ALWAYS create entities through these factories so new fields get defaults.
 * These helpers only touch state (no events, no money). Gameplay entry points
 * with rules/costs/events live in services (ctx.services.economy.build …).
 */
import type { DataRegistry } from '../data/registry';
import { DAYS_PER_MONTH } from './constants';
import { forEachTileInRect, inBounds, newId, tileIndex } from './util';
import {
  TileFlag,
  type AIState,
  type Building,
  type BuildingStats,
  type City,
  type Company,
  type CompanyId,
  type FinanceMonth,
  type GameState,
  type Route,
  type RouteStats,
  type TransportMode,
  type Vehicle,
  type VehicleStats,
} from './types';

// ---------------------------------------------------------------- finance
export function emptyFinanceMonth(year: number, month: number): FinanceMonth {
  return { year, month, ledger: {}, revenue: 0, expenses: 0, profit: 0, cashEnd: 0 };
}

// ---------------------------------------------------------------- companies
export interface CompanySpec {
  name: string;
  color: string;
  isPlayer: boolean;
  cash: number;
  tag?: string;
  logo?: string;
  ai?: AIState | null;
}

/** Create a company and add it to state.companies. */
export function createCompany(state: GameState, spec: CompanySpec): Company {
  const id = newId(state, 'company');
  const c: Company = {
    id,
    name: spec.name,
    tag: spec.tag ?? (spec.name.replace(/[^A-ZĄĆĘŁŃÓŚŹŻ]/g, '').slice(0, 3) || spec.name.slice(0, 3).toUpperCase()),
    color: spec.color,
    logo: spec.logo ?? '🏭',
    isPlayer: spec.isPlayer,
    cash: spec.cash,
    loans: [],
    creditLimit: spec.cash,
    reputation: 50,
    ecoRating: 50,
    research: { unlocked: {}, current: null, progress: 0, queue: [], budget: 0, pointsPerMonth: 0 },
    finances: {
      current: emptyFinanceMonth(state.time.year, state.time.month),
      history: [],
      lifetimeRevenue: 0,
      lifetimeProfit: 0,
      valuation: spec.cash,
      valuationHistory: [],
      taxRate: 0.19,
    },
    modifiers: {},
    unlocks: { buildings: {}, products: {}, recipes: {}, vehicles: {} },
    energy: { produced: 0, consumed: 0 },
    emissionsMonth: 0,
    emissionsHistory: [],
    hq: null,
    foundedDay: state.time.totalDays,
    bankrupt: false,
    monthsInDebt: 0,
    ai: spec.ai ?? null,
  };
  state.companies[id] = c;
  return c;
}

export const playerCompany = (state: GameState): Company => state.companies[state.playerCompanyId]!;

// ---------------------------------------------------------------- buildings
export function emptyBuildingStats(): BuildingStats {
  return {
    producedMonth: {},
    consumedMonth: {},
    soldMonth: {},
    revenueMonth: 0,
    costMonth: 0,
    profitHistory: [],
    utilizationHistory: [],
    totalProduced: 0,
    totalRevenue: 0,
  };
}

/** Footprint w/h for a rotation (odd rotations swap). */
export function footprintSize(def: { size: { w: number; h: number } }, rotation: number): { w: number; h: number } {
  return rotation % 2 === 0 ? { w: def.size.w, h: def.size.h } : { w: def.size.h, h: def.size.w };
}

/** Build a Building record (NOT added to state; use addBuilding). */
export function createBuildingRecord(
  state: GameState,
  data: DataRegistry,
  typeId: string,
  owner: CompanyId,
  x: number,
  y: number,
  rotation: 0 | 1 | 2 | 3 = 0,
): Building {
  const def = data.building(typeId);
  const { w, h } = footprintSize(def, rotation);
  const isShop = def.category === 'shop';
  const isHub = def.category === 'warehouse' || def.category === 'station' || def.category === 'export';
  return {
    id: newId(state, 'building'),
    typeId,
    owner,
    name: null,
    x,
    y,
    w,
    h,
    rotation,
    builtDay: state.time.totalDays,
    constructionProgress: def.buildDays > 0 ? 0 : 1,
    enabled: true,
    level: 1,
    upgrades: [],
    recipeId: def.recipes[0] ?? null,
    progress: 0,
    input: {},
    output: {},
    storage: {},
    workers: { required: def.workers, employed: 0, wage: 0, skill: 0.5, sourceCityId: 0, automation: 0 },
    efficiency: 0,
    condition: 1,
    status: def.buildDays > 0 ? 'construction' : 'ok',
    cityId: 0,
    priority: 3,
    shop: isShop ? { priceFactor: 1, assortment: [] } : null,
    hub: isHub ? { accept: 'all', reserve: {}, limits: {}, linked: [] } : null,
    stats: emptyBuildingStats(),
  };
}

/** Insert a building and mark its footprint in map.building. */
export function addBuilding(state: GameState, b: Building): void {
  state.buildings[b.id] = b;
  forEachTileInRect(state.map, b.x, b.y, b.w, b.h, (idx) => {
    state.map.building[idx] = b.id;
  });
}

/** Remove a building and clear its footprint. Returns the removed record. */
export function removeBuilding(state: GameState, id: number): Building | undefined {
  const b = state.buildings[id];
  if (!b) return undefined;
  forEachTileInRect(state.map, b.x, b.y, b.w, b.h, (idx) => {
    if (state.map.building[idx] === id) state.map.building[idx] = 0;
  });
  delete state.buildings[id];
  return b;
}

export function buildingAt(state: GameState, x: number, y: number): Building | undefined {
  if (!inBounds(state.map, x, y)) return undefined;
  const id = state.map.building[tileIndex(state.map, x, y)]!;
  return id ? state.buildings[id] : undefined;
}

export const buildingsOf = (state: GameState, companyId: CompanyId): Building[] =>
  Object.values(state.buildings).filter((b) => b.owner === companyId);

export interface PlaceCheck {
  ok: boolean;
  /** Polish reason when !ok. */
  reason?: string;
  /** Total cost incl. terrain multipliers. */
  cost: number;
}

/**
 * Basic placement validation: bounds, terrain, occupancy, network, deposit,
 * fertility, water access and cash. Economy may wrap it with extra rules
 * (permits, unlocks).
 */
export function checkPlacement(
  state: GameState,
  data: DataRegistry,
  companyId: CompanyId,
  typeId: string,
  x: number,
  y: number,
  rotation: 0 | 1 | 2 | 3 = 0,
): PlaceCheck {
  const def = data.buildings[typeId];
  if (!def) return { ok: false, reason: 'Nieznany typ budynku', cost: 0 };
  const { w, h } = footprintSize(def, rotation);
  const map = state.map;
  if (x < 0 || y < 0 || x + w > map.width || y + h > map.height) return { ok: false, reason: 'Poza mapą', cost: 0 };
  let costMul = 0;
  let fert = 0;
  let hasDeposit = !def.requiresDeposit;
  let reason: string | undefined;
  forEachTileInRect(map, x, y, w, h, (idx) => {
    if (reason) return;
    const t = map.terrain[idx]!;
    if (!def.allowedTerrain.includes(t as never)) reason = `Nieodpowiedni teren (${data.terrain[t]?.name ?? t})`;
    else if (map.building[idx]) reason = 'Miejsce zajęte';
    else if (state.network.road[idx] || state.network.rail[idx]) reason = 'Na drodze lub torach';
    else if (map.flags[idx]! & TileFlag.Blocked) reason = 'Teren zablokowany';
    costMul += data.terrain[t]?.buildCost ?? 1;
    fert += map.fertility[idx]!;
    if (def.requiresDeposit && map.depositTypes[map.deposit[idx]!] === def.requiresDeposit && map.depositAmount[idx]! > 0)
      hasDeposit = true;
  });
  const cost = Math.round(def.cost * (costMul / (w * h)));
  if (reason) return { ok: false, reason, cost };
  if (!hasDeposit) return { ok: false, reason: `Wymaga złoża: ${data.deposits[def.requiresDeposit!]?.name ?? def.requiresDeposit}`, cost };
  if (def.minFertility && fert / (w * h) < def.minFertility) return { ok: false, reason: 'Zbyt słaba gleba', cost };
  if (def.requiresWater) {
    let water = false;
    forEachTileInRect(map, x - 1, y - 1, w + 2, h + 2, (idx) => {
      if (data.terrain[map.terrain[idx]!]?.isWater) water = true;
    });
    if (!water) return { ok: false, reason: 'Wymaga dostępu do wody', cost };
  }
  const company = state.companies[companyId];
  if (company && company.cash < cost) return { ok: false, reason: 'Brak środków', cost };
  return { ok: true, cost };
}

// ---------------------------------------------------------------- vehicles & routes
export function emptyVehicleStats(): VehicleStats {
  return { tripsMonth: 0, deliveredMonth: 0, revenueMonth: 0, costMonth: 0, distanceMonth: 0, profitHistory: [], totalDelivered: 0 };
}

/** Build a Vehicle record at tile (x,y) (NOT added to state). */
export function createVehicleRecord(state: GameState, data: DataRegistry, typeId: string, owner: CompanyId, x: number, y: number): Vehicle {
  const def = data.vehicle(typeId);
  const id = newId(state, 'vehicle');
  const wagons = def.wagons ? def.wagons.min : 0;
  return {
    id,
    typeId,
    owner,
    mode: def.mode,
    name: `${def.name} #${id}`,
    routeId: null,
    stopIndex: 0,
    status: 'idle',
    path: [],
    pathIndex: 0,
    pathProgress: 0,
    x: x + 0.5,
    y: y + 0.5,
    prevX: x + 0.5,
    prevY: y + 0.5,
    heading: 0,
    speed: 0,
    cargo: {},
    capacity: def.wagons ? def.capacity * wagons : def.capacity,
    wagons,
    timer: 0,
    ageDays: 0,
    condition: 1,
    builtYear: state.time.year,
    depotId: 0,
    stats: emptyVehicleStats(),
  };
}

export function emptyRouteStats(): RouteStats {
  return { tripsMonth: 0, deliveredMonth: {}, revenueMonth: 0, costMonth: 0, profitHistory: [], throughputHistory: [] };
}

/** Build a Route record (NOT added to state). */
export function createRouteRecord(state: GameState, owner: CompanyId, mode: TransportMode, name: string, color = '#e8b04a'): Route {
  return {
    id: newId(state, 'route'),
    owner,
    name,
    mode,
    color,
    stops: [],
    vehicleIds: [],
    priority: 3,
    enabled: true,
    auto: false,
    createdDay: state.time.totalDays,
    stats: emptyRouteStats(),
  };
}

// ---------------------------------------------------------------- cities
/** Build a City record (NOT added to state). */
export function createCityRecord(state: GameState, name: string, x: number, y: number, population = 1000): City {
  return {
    id: newId(state, 'city'),
    name,
    x,
    y,
    radius: 3,
    tier: 'village',
    foundedYear: state.time.year,
    population: { poor: Math.round(population * 0.6), middle: Math.round(population * 0.35), rich: Math.round(population * 0.05) },
    growthRate: 0,
    satisfaction: 0.5,
    demand: {},
    preferences: {},
    greenPreference: 0.1,
    houses: [],
    labour: { workforce: Math.round(population * 0.45), employed: 0, wage: 60, skill: 0.4, commuteRadius: 12 },
    opinion: {},
    permits: {},
    isPort: false,
    regionId: 0,
    history: { population: [], satisfaction: [] },
  };
}

export const cityPopulation = (c: City): number => c.population.poor + c.population.middle + c.population.rich;

/** Days elapsed → months (float), handy for ages. */
export const daysToMonths = (d: number): number => d / DAYS_PER_MONTH;
