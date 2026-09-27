/**
 * Cross-module service contracts.
 *
 * Modules call each other's gameplay entry points through ctx.services.<name>
 * (e.g. the AI builds via ctx.services.economy.build, the UI buys trucks via
 * ctx.services.logistics.buyVehicle). Each owning module REPLACES the default
 * implementation in its init():
 *
 *   ctx.services.logistics = createLogisticsService(ctx);          // whole object
 *   Object.assign(ctx.services.economy, { build: myBuild });         // or partially
 *
 * Defaults below are minimal fallbacks so everything runs before the owner
 * module lands (some work, others return { ok:false, reason:'Niezaimplementowane' }).
 * Services operate on the CURRENT ctx.state and emit bus events themselves.
 *
 * Changing a signature = contract change → note it in docs/CONTRACTS.md changelog.
 */
import type { GameContext } from './context';
import { addBuilding, checkPlacement, createBuildingRecord, removeBuilding, type PlaceCheck } from './entities';
import { addMoney } from './money';
import type {
  BuildingId,
  CityId,
  CompanyId,
  LoanId,
  NewGameOptions,
  ProductId,
  RegionWeather,
  RouteId,
  RouteStop,
  TileIndex,
  TransportMode,
  VehicleId,
} from './types';
import { dist, inBounds, tileIndex } from './util';

/** Result of a gameplay action. `cost` = money spent (negative = refund). */
export type ActionResult<T extends object = object> = ({ ok: true; cost: number } & T) | { ok: false; reason: string };

export type UnlockKind = 'building' | 'vehicle' | 'product' | 'recipe';

// ---------------------------------------------------------------- economy (data+economy agent)
export interface EconomyService {
  /** Validate a placement (terrain, occupancy, deposit, cash, unlocks, permits). */
  checkPlacement(companyId: CompanyId, typeId: string, x: number, y: number, rotation: 0 | 1 | 2 | 3): PlaceCheck;
  /** Place a building (pays, emits building:built + sfx). */
  build(companyId: CompanyId, typeId: string, x: number, y: number, rotation: 0 | 1 | 2 | 3): ActionResult<{ id: BuildingId }>;
  /** Demolish (refund part of cost, emits building:removed). */
  demolish(buildingId: BuildingId): ActionResult;
  setRecipe(buildingId: BuildingId, recipeId: string): boolean;
  /** Current price of a product (optionally local to a city). */
  price(productId: ProductId, cityId?: CityId): number;
  isUnlocked(companyId: CompanyId, kind: UnlockKind, id: string): boolean;
  startResearch(companyId: CompanyId, techId: string): ActionResult;
  takeLoan(companyId: CompanyId, amount: number, termMonths: number): ActionResult<{ loanId: LoanId }>;
  repayLoan(companyId: CompanyId, loanId: LoanId, amount?: number): ActionResult;
  /** Current company valuation. */
  companyValue(companyId: CompanyId): number;
  /** Buy a building from another company (acquisition). */
  acquireBuilding(companyId: CompanyId, buildingId: BuildingId): ActionResult;
  /** OPTIONAL: switch a building on/off (UI falls back to toggling Building.enabled + 'building:changed'). */
  setBuildingEnabled?(buildingId: BuildingId, enabled: boolean): boolean;
  /** OPTIONAL: install a BuildingDef.upgrades entry (pays; UI falls back to a simple trySpend + push). */
  upgradeBuilding?(buildingId: BuildingId, upgradeId: string): ActionResult;
  /** OPTIONAL (economy): shop price multiplier 0.5..2 vs local price (lower = more customers). */
  setShopPrice?(buildingId: BuildingId, priceFactor: number): boolean;
  /** OPTIONAL (economy): monthly R&D budget in zł (converted to research points, spent only while researching). */
  setResearchBudget?(companyId: CompanyId, amount: number): boolean;
  /** OPTIONAL (economy): queue a tech (missing prerequisites are queued first); starts at once if idle. */
  queueResearch?(companyId: CompanyId, techId: string): ActionResult;
  /** OPTIONAL (economy): pause current research (progress is kept). */
  cancelResearch?(companyId: CompanyId): boolean;
  /** OPTIONAL (economy): restore building condition to 100% (pays repair cost). */
  repairBuilding?(buildingId: BuildingId): ActionResult;
}

// ---------------------------------------------------------------- logistics (logistics agent)
export interface RouteSpec {
  mode: TransportMode;
  name?: string;
  color?: string;
  stops: RouteStop[];
  priority?: number;
  /** updateRoute only: pause / resume the route. */
  enabled?: boolean;
}

/** Options for LogisticsService.buyVehicle (additive, logistics). */
export interface BuyVehicleOptions {
  /** Building where the vehicle appears (depot / station); default: first route stop / any own station. */
  depotId?: BuildingId;
  /** Train wagons (clamped to VehicleDef.wagons; each wagon costs costPerWagon). */
  wagons?: number;
}

/** A missing producer → consumer connection (advisor / AI hints). */
export interface RouteSuggestion {
  fromBuilding: BuildingId;
  toBuilding: BuildingId;
  productId: ProductId;
  /** Straight-line distance in tiles. */
  distance: number;
  /** Already reachable by road. */
  connected: boolean;
  /** Higher = more urgent. */
  score: number;
}

export interface LogisticsService {
  /** Build road/rail on tiles (ordered path). level = RoadKind/RailKind. */
  buildNetwork(companyId: CompanyId, kind: 'road' | 'rail', tiles: TileIndex[], level?: number): ActionResult;
  removeNetwork(companyId: CompanyId, kind: 'road' | 'rail', tiles: TileIndex[]): ActionResult;
  /** Cost/feasibility without changing state (for previews). */
  estimateNetwork(companyId: CompanyId, kind: 'road' | 'rail', tiles: TileIndex[], level?: number): ActionResult;
  /** Suggested tile path for building a road/rail between two tiles (A* over terrain). */
  planNetworkPath(kind: 'road' | 'rail', from: TileIndex, to: TileIndex): TileIndex[] | null;
  /** Path over the existing network for a vehicle mode. */
  findPath(mode: TransportMode, from: TileIndex, to: TileIndex): TileIndex[] | null;
  /** Are two buildings connected for this mode? */
  isConnected(mode: TransportMode, fromBuilding: BuildingId, toBuilding: BuildingId): boolean;
  createRoute(companyId: CompanyId, spec: RouteSpec): ActionResult<{ id: RouteId }>;
  updateRoute(routeId: RouteId, spec: Partial<RouteSpec>): boolean;
  removeRoute(routeId: RouteId): boolean;
  buyVehicle(companyId: CompanyId, typeId: string, routeId: RouteId | null, opts?: BuyVehicleOptions): ActionResult<{ id: VehicleId }>;
  sellVehicle(vehicleId: VehicleId): ActionResult;
  assignVehicle(vehicleId: VehicleId, routeId: RouteId | null): boolean;
  /** Build road (if needed) + route + vehicle between producer and consumer. */
  autoConnect(companyId: CompanyId, fromBuilding: BuildingId, toBuilding: BuildingId, mode: TransportMode): ActionResult<{ routeId: RouteId }>;
  /** Unserved producer → consumer pairs of a company, best first (advisor / AI). */
  suggestRoutes(companyId: CompanyId, limit?: number): RouteSuggestion[];
}

// ---------------------------------------------------------------- world (world agent)
export interface WorldService {
  /** City owning the tile (0 = none). */
  cityAt(x: number, y: number): CityId;
  /** Nearest city center within maxDist tiles (0 = none). */
  nearestCity(x: number, y: number, maxDist?: number): CityId;
  /** Weather region index for a tile. */
  regionAt(x: number, y: number): number;
  isBuildableTile(x: number, y: number): boolean;
  /** Tile indices within a disk of radius r (clipped to the map). [world, additive] */
  tilesInRadius(x: number, y: number, r: number): TileIndex[];
  /** Road/rail construction cost multiplier of a tile (terrain × slope × river/bridge; Infinity = impossible). */
  terrainCost(x: number, y: number, kind: 'road' | 'rail'): number;
  /** Weather of the region containing the tile (null = no weather). */
  weatherAt(x: number, y: number): RegionWeather | null;
  /**
   * Combined weather × world-event multiplier for a key at a tile (1 = neutral), e.g.
   * 'speed.water' (0 = blocked by storm), 'speed.road', 'efficiency.farm', 'season.farm'.
   * x/y omitted = only global events. See CONTRACTS "Świat — API".
   */
  modifierAt(key: string, x?: number, y?: number): number;
}

// ---------------------------------------------------------------- game (ai/game/audio agent)
export interface ScenarioInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** 1..5 */
  difficulty: number;
  /** New-game options the scenario forces. */
  options: Partial<NewGameOptions>;
}

export interface GameService {
  scenarios(): ScenarioInfo[];
  /** Current advisor suggestion for the player (null = nothing to say). */
  currentHint(): string | null;
}

export interface AudioService {
  /** Resume AudioContext after a user gesture. */
  unlock(): void;
  play(id: string, opts?: { x?: number; y?: number; volume?: number }): void;
  setMusic(on: boolean): void;
  /** Re-read ctx.userSettings volumes. */
  applySettings(): void;
}

// ---------------------------------------------------------------- ai (ai/game/audio agent)
export interface AiService {
  /** Asking price for another company's building (null = not for sale / unknown). */
  buildingPrice(buyerId: CompanyId, buildingId: BuildingId): number | null;
  /** Buy a rival's building (takeover). Pays seller, transfers ownership, emits building:changed. */
  buyBuilding(buyerId: CompanyId, buildingId: BuildingId): ActionResult;
}

export interface Services {
  ai: AiService;
  economy: EconomyService;
  logistics: LogisticsService;
  world: WorldService;
  game: GameService;
  audio: AudioService;
}

// ============================================================================
// Default fallbacks
// ============================================================================

const NI = { ok: false as const, reason: 'Niezaimplementowane' };

export function createDefaultServices(ctx: GameContext): Services {
  const economy: EconomyService = {
    checkPlacement: (companyId, typeId, x, y, rot) => checkPlacement(ctx.state, ctx.data, companyId, typeId, x, y, rot),
    build(companyId, typeId, x, y, rot) {
      const chk = checkPlacement(ctx.state, ctx.data, companyId, typeId, x, y, rot);
      if (!chk.ok) return { ok: false, reason: chk.reason ?? 'Nie można budować' };
      const b = createBuildingRecord(ctx.state, ctx.data, typeId, companyId, x, y, rot);
      addBuilding(ctx.state, b);
      addMoney(ctx, companyId, -chk.cost, 'construction');
      ctx.bus.emit('building:built', { buildingId: b.id });
      ctx.bus.emit('map:changed', { x: b.x, y: b.y, w: b.w, h: b.h });
      ctx.bus.emit('sfx', { id: 'build', x, y });
      return { ok: true, cost: chk.cost, id: b.id };
    },
    demolish(buildingId) {
      const b = ctx.state.buildings[buildingId];
      if (!b) return { ok: false, reason: 'Brak budynku' };
      const refund = Math.round((ctx.data.buildings[b.typeId]?.cost ?? 0) * 0.25);
      removeBuilding(ctx.state, buildingId);
      if (b.owner) addMoney(ctx, b.owner, refund, 'assetSale');
      ctx.bus.emit('building:removed', { buildingId, typeId: b.typeId, owner: b.owner, x: b.x, y: b.y, w: b.w, h: b.h });
      ctx.bus.emit('map:changed', { x: b.x, y: b.y, w: b.w, h: b.h });
      ctx.bus.emit('sfx', { id: 'demolish', x: b.x, y: b.y });
      return { ok: true, cost: -refund };
    },
    setRecipe(buildingId, recipeId) {
      const b = ctx.state.buildings[buildingId];
      if (!b || !ctx.data.buildings[b.typeId]?.recipes.includes(recipeId)) return false;
      b.recipeId = recipeId;
      b.progress = 0;
      ctx.bus.emit('building:changed', { buildingId });
      return true;
    },
    price: (productId) => ctx.state.market.products[productId]?.price ?? ctx.data.products[productId]?.basePrice ?? 0,
    isUnlocked(companyId, kind, id) {
      const c = ctx.state.companies[companyId];
      const map = { building: 'buildings', vehicle: 'vehicles', product: 'products', recipe: 'recipes' } as const;
      if (c && c.unlocks[map[kind]][id]) return true;
      const def =
        kind === 'building' ? ctx.data.buildings[id] : kind === 'vehicle' ? ctx.data.vehicles[id] : kind === 'product' ? ctx.data.products[id] : undefined;
      const era = def && 'era' in def ? def.era : undefined;
      return era ? ctx.data.eraIndex(era) <= ctx.data.eraIndex(ctx.state.time.eraId) : true;
    },
    startResearch: () => NI,
    takeLoan: () => NI,
    repayLoan: () => NI,
    companyValue: (companyId) => ctx.state.companies[companyId]?.finances.valuation ?? 0,
    acquireBuilding: () => NI,
  };

  const logistics: LogisticsService = {
    buildNetwork: () => NI,
    removeNetwork: () => NI,
    estimateNetwork: () => NI,
    planNetworkPath: () => null,
    findPath: () => null,
    isConnected: () => false,
    createRoute: () => NI,
    updateRoute: () => false,
    removeRoute: () => false,
    buyVehicle: () => NI,
    sellVehicle: () => NI,
    assignVehicle: () => false,
    autoConnect: () => NI,
    suggestRoutes: () => [],
  };

  const world: WorldService = {
    cityAt(x, y) {
      const m = ctx.state.map;
      return inBounds(m, x, y) ? m.city[tileIndex(m, x, y)]! : 0;
    },
    nearestCity(x, y, maxDist = Infinity) {
      let best = 0;
      let bd = maxDist;
      for (const c of Object.values(ctx.state.cities)) {
        const d = dist(x, y, c.x, c.y);
        if (d <= bd) {
          bd = d;
          best = c.id;
        }
      }
      return best;
    },
    regionAt(x, y) {
      const w = ctx.state.weather;
      const cx = Math.min(w.cols - 1, Math.max(0, Math.floor(x / w.regionSize)));
      const cy = Math.min(w.rows - 1, Math.max(0, Math.floor(y / w.regionSize)));
      return cy * w.cols + cx;
    },
    isBuildableTile(x, y) {
      const m = ctx.state.map;
      if (!inBounds(m, x, y)) return false;
      const i = tileIndex(m, x, y);
      return !!ctx.data.terrain[m.terrain[i]!]?.buildable && !m.building[i] && !ctx.state.network.road[i] && !ctx.state.network.rail[i];
    },
    tilesInRadius(x, y, r) {
      const m = ctx.state.map;
      const out: TileIndex[] = [];
      for (let ty = Math.max(0, Math.floor(y - r)); ty <= Math.min(m.height - 1, Math.ceil(y + r)); ty++)
        for (let tx = Math.max(0, Math.floor(x - r)); tx <= Math.min(m.width - 1, Math.ceil(x + r)); tx++)
          if (dist(x, y, tx, ty) <= r) out.push(tileIndex(m, tx, ty));
      return out;
    },
    terrainCost(x, y) {
      const m = ctx.state.map;
      if (!inBounds(m, x, y)) return Infinity;
      return ctx.data.terrain[m.terrain[tileIndex(m, x, y)]!]?.networkCost ?? 1;
    },
    weatherAt(x, y) {
      const w = ctx.state.weather;
      if (!w.regions.length) return null;
      return w.regions[world.regionAt(x, y)] ?? null;
    },
    modifierAt: () => 1,
  };

  const game: GameService = { scenarios: () => [], currentHint: () => null };
  const audio: AudioService = { unlock: () => {}, play: () => {}, setMusic: () => {}, applySettings: () => {} };

  const ai: AiService = { buildingPrice: () => null, buyBuilding: () => NI };

  return { economy, logistics, world, game, audio, ai };
}
