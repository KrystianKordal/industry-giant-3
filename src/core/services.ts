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
}

// ---------------------------------------------------------------- logistics (logistics agent)
export interface RouteSpec {
  mode: TransportMode;
  name?: string;
  color?: string;
  stops: RouteStop[];
  priority?: number;
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
  buyVehicle(companyId: CompanyId, typeId: string, routeId: RouteId | null): ActionResult<{ id: VehicleId }>;
  sellVehicle(vehicleId: VehicleId): ActionResult;
  assignVehicle(vehicleId: VehicleId, routeId: RouteId | null): boolean;
  /** Build road (if needed) + route + vehicle between producer and consumer. */
  autoConnect(companyId: CompanyId, fromBuilding: BuildingId, toBuilding: BuildingId, mode: TransportMode): ActionResult<{ routeId: RouteId }>;
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

export interface Services {
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
  };

  const game: GameService = { scenarios: () => [], currentHint: () => null };
  const audio: AudioService = { unlock: () => {}, play: () => {}, setMusic: () => {}, applySettings: () => {} };

  return { economy, logistics, world, game, audio };
}
