/**
 * ============================================================================
 *  Industry Giant 3 — COMPLETE serializable game state model.
 * ============================================================================
 *
 * Rules (see docs/CONTRACTS.md):
 *  - GameState is PLAIN DATA: objects, arrays, numbers, strings, booleans, null
 *    and typed arrays (save.ts encodes typed arrays). No classes, functions,
 *    Maps, Sets, Dates or DOM refs anywhere inside.
 *  - Entities are stored in `Record<id, Entity>` keyed by numeric ids (>= 1).
 *    0 means "none" (NONE) in refs and typed arrays.
 *  - Data definitions (products, buildings, …) live in src/data and are
 *    referenced by string ids. Never copy a whole def into state.
 *  - Money is a plain number in game currency ("zł"); quantities are units
 *    (floats allowed); quality is 0..1 (0.5 = standard).
 *  - Tile index: idx = y * map.width + x  (use tileIndex()/tileXY() helpers).
 *  - Monthly history arrays are capped at HISTORY_MONTHS, oldest first
 *    (push new value at the end, shift when too long — use pushHistory()).
 *  - Anything marked "derived" may be recomputed at any time from other state.
 *  - Runtime-only caches (path caches, sprite caches …) must NOT live here;
 *    keep them in module-level variables and rebuild on `game:loaded`.
 */

import type { ModPack } from '../data/defs';

// ============================================================================
// Primitive id aliases
// ============================================================================

/** Numeric entity id (>= 1). 0 = none. */
export type EntityId = number;
export type BuildingId = EntityId;
export type VehicleId = EntityId;
export type RouteId = EntityId;
export type CityId = EntityId;
/** Company id (>= 1). 0 = public / nobody (PUBLIC_OWNER). */
export type CompanyId = EntityId;
export type NotificationId = EntityId;
export type LoanId = EntityId;
export type WorldEventId = EntityId;

/** Data-definition ids (strings, see src/data). */
export type ProductId = string;
export type RecipeId = string;
export type BuildingTypeId = string;
export type VehicleTypeId = string;
export type TechId = string;
export type EraId = string;
export type DepositTypeId = string;
export type ScenarioId = string;
export type BlueprintId = string;

/** Flat tile index: y * width + x. */
export type TileIndex = number;

// ============================================================================
// Enumerations (const objects, JSON friendly)
// ============================================================================

/** Terrain type stored per tile in `map.terrain` (Uint8). Metadata in data/terrain.ts. */
export const Terrain = {
  DeepWater: 0,
  Water: 1, // shallow sea / lake
  Beach: 2,
  Grass: 3, // plains
  Forest: 4,
  Hills: 5,
  Mountain: 6,
  Desert: 7,
  Snow: 8, // tundra / snow
  Swamp: 9,
  Farmland: 10, // cultivated land (set by farms)
  Urban: 11, // city ground (streets/houses) — see map.house
} as const;
export type TerrainId = (typeof Terrain)[keyof typeof Terrain];
export const TERRAIN_COUNT = 12;

/** Bit flags stored per tile in `map.flags` (Uint8). Road/rail live in NetworkState. */
export const TileFlag = {
  River: 1 << 0, // river flows through tile (water transport for small boats, fertility bonus)
  Coast: 1 << 1, // land tile adjacent to sea (ports allowed)
  Bridge: 1 << 2, // bridge over water carrying road/rail
  Tunnel: 1 << 3, // tunnel through mountain carrying road/rail
  Canal: 1 << 4, // artificial waterway
  Blocked: 1 << 5, // not buildable (scenario/reserved/landmark)
  Damaged: 1 << 6, // disaster damage (infrastructure unusable until repaired)
  Reserved: 1 << 7, // free for future use
} as const;
export type TileFlagBit = (typeof TileFlag)[keyof typeof TileFlag];

/** Road kind per tile in `network.road`. 0 = none. */
export const RoadKind = { None: 0, Dirt: 1, Paved: 2, Highway: 3 } as const;
export type RoadKindId = (typeof RoadKind)[keyof typeof RoadKind];

/** Rail kind per tile in `network.rail`. 0 = none. */
export const RailKind = { None: 0, Standard: 1, Electrified: 2, HighSpeed: 3 } as const;
export type RailKindId = (typeof RailKind)[keyof typeof RailKind];

/**
 * Direction bits for connection masks (`network.roadConn` uses 4 dirs,
 * `network.railConn` may use all 8).
 */
export const Dir = {
  N: 1 << 0,
  E: 1 << 1,
  S: 1 << 2,
  W: 1 << 3,
  NE: 1 << 4,
  SE: 1 << 5,
  SW: 1 << 6,
  NW: 1 << 7,
} as const;

export type TransportMode = 'road' | 'rail' | 'water' | 'air';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
/** 1x, 2x, 4x (pause is separate: TimeState.paused). */
export type GameSpeed = 1 | 2 | 4;
export type Difficulty = 'easy' | 'normal' | 'hard';
export type GameMode = 'sandbox' | 'campaign';
export type SocialClass = 'poor' | 'middle' | 'rich';
export type NotificationLevel = 'info' | 'success' | 'warning' | 'danger';
export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'heat' | 'fog';
export type ClimateZone = 'temperate' | 'continental' | 'arid' | 'tropical' | 'arctic';
export type MapPreset = 'continent' | 'islands' | 'inland' | 'coast' | 'archipelago';

// ============================================================================
// Common value types
// ============================================================================

/** Amount of one product with its average quality. */
export interface StockEntry {
  /** Units held (float OK). */
  qty: number;
  /** Weighted-average quality 0..1 (0.5 = standard). Mix with mixQuality() helper. */
  quality: number;
}

/** Product stock: { [productId]: { qty, quality } }. Missing key = 0 units. */
export type Stock = Record<ProductId, StockEntry>;

export interface TilePos {
  x: number;
  y: number;
}

export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Reference to anything selectable / targetable (notifications, selection, advisor). */
export type EntityRef =
  | { kind: 'building'; id: BuildingId }
  | { kind: 'vehicle'; id: VehicleId }
  | { kind: 'route'; id: RouteId }
  | { kind: 'city'; id: CityId }
  | { kind: 'company'; id: CompanyId }
  | { kind: 'tile'; x: number; y: number };

/** Per-product numeric map (units, money, …). */
export type ProductAmounts = Record<ProductId, number>;

// ============================================================================
// Root state
// ============================================================================

export interface GameState {
  /** Save-format version (SAVE_VERSION at time of creation/migration). */
  version: number;
  /** Save / session metadata. */
  meta: GameMeta;
  /** Options this game was created with (difficulty, map size, rivals…). Mostly immutable. */
  settings: GameSettings;
  /** Gameplay RNG stream (mulberry32 state). Use core/rng.ts; never Math.random in sims. */
  rng: RngState;
  /** Calendar, speed, era. */
  time: TimeState;
  /** Tile grid (terrain, deposits, pollution, occupancy) as typed arrays. */
  map: MapState;
  /** Road / rail per tile. */
  network: NetworkState;
  /** Per-kind id counters. Use newId(state, kind). */
  nextIds: IdCounters;

  /** Player company id (key into companies). */
  playerCompanyId: CompanyId;
  /** Player + AI companies. */
  companies: Record<CompanyId, Company>;
  /** All buildings of all owners (incl. shops, warehouses, stations, labs). */
  buildings: Record<BuildingId, Building>;
  /** All vehicles (trucks, trains, ships, planes/drones). */
  vehicles: Record<VehicleId, Vehicle>;
  /** Transport routes (stop lists with orders). */
  routes: Record<RouteId, Route>;
  /** Cities with demographics & demand. */
  cities: Record<CityId, City>;

  /** Global commodity market (prices, supply/demand). */
  market: MarketState;
  /** Global environment state (per-tile pollution lives in map.pollution). */
  ecology: EcologyState;
  /** Active & past world events (disasters, politics, economy). */
  events: EventsState;
  /** Regional weather grid. */
  weather: WeatherState;
  /** Message log / inbox (toasts are emitted separately via bus 'notify'). */
  notifications: NotificationsState;
  /** Scenario objectives, milestones, win/lose status. */
  goals: GoalsState;
  /** Mentor / tutorial progress. */
  advisor: AdvisorState;
  /** Saved building layouts. */
  blueprints: Record<BlueprintId, Blueprint>;
  /** Global time series for charts. */
  stats: StatsState;
  /** Camera / overlay to restore on load (written on 'game:beforeSave'). */
  view: ViewState;
  /** Mod packs active in this game (embedded so saves are self-contained). */
  mods: ModPack[];
  /**
   * Extension slot for module-private persistent data that doesn't fit above.
   * Key = owning directory name (e.g. ext.logistics = {...}). Must stay plain data.
   */
  ext: Record<string, unknown>;
}

// ============================================================================
// Meta & settings
// ============================================================================

export interface GameMeta {
  /** Random unique id of this playthrough. */
  id: string;
  /** Display name (default: company name + seed). */
  name: string;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last save ('' if never). */
  savedAt: string;
  /** Real seconds played (accumulated by sim while unpaused). */
  playTimeSec: number;
  /** GAME_VERSION that created/last saved the game. */
  gameVersion: string;
}

/** Options chosen on the "new game" screen. Also stored as GameState.settings. */
export interface NewGameOptions {
  /** Map seed (uint32). Same seed + options => same map. */
  seed: number;
  mapWidth: number;
  mapHeight: number;
  mapPreset: MapPreset;
  /** 0..1 — how much of the map is water (0.35 default). */
  waterLevel: number;
  /** Number of cities to generate. */
  cityCount: number;
  /** Resource deposit abundance multiplier (0.5..2, 1 = normal). */
  resourceAbundance: number;
  difficulty: Difficulty;
  /** Number of AI rival companies (0..7). */
  rivals: number;
  /** Starting calendar year (era is derived from it). */
  startYear: number;
  companyName: string;
  /** CSS color of the player company. */
  companyColor: string;
  mode: GameMode;
  /** Campaign scenario id (mode = 'campaign'). */
  scenarioId: ScenarioId | null;
  /** Enable natural disasters. */
  disasters: boolean;
  /** Enable political/economic random events. */
  politicalEvents: boolean;
  /** Starting cash override (null = from difficulty). */
  startCash: number | null;
}

export type GameSettings = NewGameOptions;

/** User preferences (NOT part of GameState; stored in localStorage 'ig3.settings'). */
export interface UserSettings {
  masterVolume: number; // 0..1
  musicVolume: number; // 0..1
  sfxVolume: number; // 0..1
  ambientVolume: number; // 0..1
  muted: boolean;
  /** UI scale multiplier (0.8..1.5). */
  uiScale: number;
  /** Scroll camera when mouse touches screen edge. */
  edgeScroll: boolean;
  /** Keyboard/edge pan speed multiplier. */
  scrollSpeed: number;
  /** Autosave every N game months (0 = off). */
  autosaveMonths: number;
  showGrid: boolean;
  dayNightCycle: boolean;
  tiltShift: boolean;
  showFps: boolean;
  reducedMotion: boolean;
  /** Show mentor / advisor hints. */
  advisorEnabled: boolean;
  language: 'pl';
}

// ============================================================================
// RNG & time
// ============================================================================

export interface RngState {
  /** Original seed. */
  seed: number;
  /** Current mulberry32 internal state (uint32). */
  s: number;
}

export interface TimeState {
  /** Sim ticks since game start. */
  tick: number;
  /** Whole days elapsed since game start (the "day number"; used for timestamps). */
  totalDays: number;
  /** Progress through the current day 0..1 (for interpolation, day/night). */
  dayFraction: number;
  /** Day of month 1..DAYS_PER_MONTH. */
  day: number;
  /** Month 1..12. */
  month: number;
  year: number;
  /** Derived from month: 3-5 spring, 6-8 summer, 9-11 autumn, 12-2 winter. */
  season: Season;
  /** Selected speed multiplier (kept while paused). */
  speed: GameSpeed;
  paused: boolean;
  /** Current technological era (data/eras.ts). */
  eraId: EraId;
  /** Year the game started (for stats/relative time). */
  startYear: number;
}

// ============================================================================
// Map
// ============================================================================

/**
 * Tile data as struct-of-arrays. Every array has length width*height and is
 * indexed by TileIndex. Typed arrays are encoded by save.ts automatically.
 */
export interface MapState {
  width: number;
  height: number;
  /** Seed used by mapgen. */
  seed: number;
  /** Elevation threshold (0..255) below which a tile is water. */
  seaLevel: number;
  /** Dominant climate of the map (regions may differ, see weather). */
  climate: ClimateZone;
  /** TerrainId per tile. */
  terrain: Uint8Array;
  /** Elevation 0..255 (for shading, build cost, rivers). */
  elevation: Uint8Array;
  /** Soil fertility 0..255 (farm output & quality). */
  fertility: Uint8Array;
  /** Tree density 0..255 (forestry output; cleared when building). */
  forest: Uint8Array;
  /** Bit set of TileFlag. */
  flags: Uint8Array;
  /**
   * Palette for `deposit`: index -> DepositTypeId. Index 0 is always '' (none).
   * Mapgen fills it from registry deposits; stored in state so saves are stable
   * even if data order changes.
   */
  depositTypes: DepositTypeId[];
  /** Index into depositTypes (0 = no deposit). */
  deposit: Uint8Array;
  /** Remaining extractable units of the deposit. */
  depositAmount: Float32Array;
  /** Deposit quality 0..255 (-> 0..1). Feeds product quality of raw buildings. */
  depositQuality: Uint8Array;
  /** Accumulated pollution 0..(~255+) per tile (air/soil). Decays over time (ecology). */
  pollution: Float32Array;
  /** BuildingId occupying the tile (0 = free). Every footprint tile is set. */
  building: Uint32Array;
  /** CityId the tile belongs to (city area / houses), 0 = countryside. */
  city: Uint16Array;
  /** House density on urban tiles: 0 none, 1..5 (hut → tower). Managed by world/cities. */
  house: Uint8Array;
}

/** Transport infrastructure per tile (all arrays length width*height). */
export interface NetworkState {
  /** RoadKindId per tile (0 = none). */
  road: Uint8Array;
  /** Road connections bitmask (Dir.N|E|S|W). */
  roadConn: Uint8Array;
  /** RailKindId per tile (0 = none). */
  rail: Uint8Array;
  /** Rail connections bitmask (8 dirs, Dir.*). */
  railConn: Uint8Array;
  /** Owning company of the infrastructure on the tile (0 = public/city). */
  owner: Uint16Array;
  /** Recent traffic counter (vehicle passes, decays daily) — congestion & heatmap. */
  traffic: Uint16Array;
  /** Incremented on every network change; lets pathfinding caches detect staleness. */
  version: number;
}

export interface IdCounters {
  building: number;
  vehicle: number;
  route: number;
  city: number;
  company: number;
  notification: number;
  loan: number;
  event: number;
}

// ============================================================================
// Companies, finance, research, AI
// ============================================================================

export interface Company {
  id: CompanyId;
  name: string;
  /** Short tag (2-4 chars) for compact UI. */
  tag: string;
  /** CSS color used on map/charts. */
  color: string;
  /** Emoji logo. */
  logo: string;
  isPlayer: boolean;
  /** Current cash (may go negative → bankruptcy checks by finance). */
  cash: number;
  loans: Loan[];
  /** Max total loan principal allowed (derived from valuation/rating). */
  creditLimit: number;
  /** General reputation 0..100 (quality, reliability, supply). */
  reputation: number;
  /** Environmental rating 0..100 (emissions, green products). */
  ecoRating: number;
  research: ResearchState;
  finances: CompanyFinances;
  /**
   * Multiplicative/additive modifiers from techs, events, upgrades.
   * Key convention: "<effect>.<target>" e.g. "efficiency.factory", "speed.rail",
   * "quality.bakery", "emissions.all", "upkeep.vehicles". Read via getModifier().
   */
  modifiers: Record<string, number>;
  /** Derived cache of unlocked content (rebuilt by research on load/unlock). */
  unlocks: UnlockState;
  /** Energy balance this month (MWh produced vs consumed by own buildings). */
  energy: { produced: number; consumed: number };
  /** CO2-equivalent emitted this month (accumulator) and monthly history. */
  emissionsMonth: number;
  emissionsHistory: number[];
  /** HQ tile (null until placed). */
  hq: TilePos | null;
  /** totalDays when founded. */
  foundedDay: number;
  /** Bankrupt companies stop acting; their assets may be auctioned. */
  bankrupt: boolean;
  /** Consecutive months with negative cash (finance bankruptcy logic). */
  monthsInDebt: number;
  /** AI brain state; null for the player. */
  ai: AIState | null;
}

export interface Loan {
  id: LoanId;
  /** Original amount. */
  principal: number;
  /** Outstanding amount. */
  remaining: number;
  /** Annual interest rate (0.08 = 8%). */
  annualRate: number;
  /** Fixed monthly payment (principal+interest). */
  monthlyPayment: number;
  /** Term in months. */
  termMonths: number;
  takenDay: number;
}

/** Categories for the company ledger. Income is positive, expenses negative. */
export type FinanceCategory =
  | 'sales' // shop sales to cities
  | 'trade' // sales to other companies / market
  | 'export' // export center / port exports
  | 'subsidy'
  | 'assetSale' // selling buildings/vehicles
  | 'loanIn' // loan principal received (not revenue)
  | 'otherIncome'
  | 'construction' // building/road/rail construction
  | 'demolition'
  | 'vehiclePurchase'
  | 'buildingUpkeep'
  | 'vehicleUpkeep'
  | 'infraUpkeep' // road/rail maintenance
  | 'wages'
  | 'purchases' // buying goods/raw materials from market
  | 'energy'
  | 'research'
  | 'interest'
  | 'loanRepayment' // principal repaid (not an operating expense)
  | 'taxes'
  | 'emissionTax'
  | 'fines'
  | 'disaster'
  | 'otherExpense';

/** Categories excluded from operating profit (financing flows). */
export const NON_OPERATING_CATEGORIES: readonly FinanceCategory[] = ['loanIn', 'loanRepayment'];

export interface FinanceMonth {
  year: number;
  month: number;
  /** Signed amounts per category (+ income, − expense). */
  ledger: Partial<Record<FinanceCategory, number>>;
  /** Sum of positive operating entries. */
  revenue: number;
  /** Sum of negative operating entries (as positive number). */
  expenses: number;
  /** revenue − expenses. */
  profit: number;
  /** Cash at month close (0 while month is open). */
  cashEnd: number;
}

export interface CompanyFinances {
  /** The open (current) month accumulating entries. */
  current: FinanceMonth;
  /** Closed months, oldest first, max HISTORY_MONTHS. */
  history: FinanceMonth[];
  lifetimeRevenue: number;
  lifetimeProfit: number;
  /** Company valuation (assets + cash − debt + goodwill), updated monthly. */
  valuation: number;
  valuationHistory: number[];
  /** Corporate tax rate applied to positive monthly profit. */
  taxRate: number;
}

export interface ResearchState {
  /** Unlocked techs -> totalDays when unlocked. */
  unlocked: Record<TechId, number>;
  /** Tech currently researched (null = idle). */
  current: TechId | null;
  /** Research points accumulated toward `current`. */
  progress: number;
  /** Queue of techs to research after current. */
  queue: TechId[];
  /** Monthly money budget allocated to R&D. */
  budget: number;
  /** Derived: points per month produced (labs + budget), for UI ETA. */
  pointsPerMonth: number;
}

/** Derived content unlocks (from era + research). Keys present = unlocked. */
export interface UnlockState {
  buildings: Record<BuildingTypeId, true>;
  products: Record<ProductId, true>;
  recipes: Record<RecipeId, true>;
  vehicles: Record<VehicleTypeId, true>;
}

export type AIPersonality =
  | 'balanced'
  | 'aggressive' // expands fast, undercuts prices, takes loans
  | 'cautious' // slow, profitable, few loans
  | 'industrialist' // long heavy-industry chains
  | 'merchant' // shops & logistics focus
  | 'green'; // eco-friendly tech

export interface AIState {
  personality: AIPersonality;
  difficulty: Difficulty;
  /** Next day (totalDays) the AI will run its planner. */
  nextThinkDay: number;
  /** Product chains the AI focuses on (end products). */
  focusProducts: ProductId[];
  /** Active multi-step plans. */
  plans: AIPlan[];
  /** Free-form memory for the AI module (plain data only). */
  memory: Record<string, number | string | boolean>;
}

export interface AIPlan {
  id: number;
  kind: string; // e.g. 'buildChain', 'expandShop', 'connectRoute'
  status: 'pending' | 'active' | 'done' | 'failed';
  /** Plan parameters (building ids, product ids, positions). */
  params: Record<string, number | string | boolean | number[]>;
  createdDay: number;
}

// ============================================================================
// Buildings
// ============================================================================

export type BuildingStatus =
  | 'ok' // producing / operating
  | 'construction' // being built (see constructionProgress)
  | 'disabled' // switched off by owner
  | 'noInput' // waiting for inputs
  | 'outputFull' // output buffer full
  | 'noWorkers' // not enough workers
  | 'noDeposit' // deposit depleted / missing
  | 'noCustomers' // shop without demand/city
  | 'noPower'
  | 'damaged' // disaster damage
  | 'noPermit'; // regulation / city denied permit

export interface Building {
  id: BuildingId;
  /** BuildingDef id. */
  typeId: BuildingTypeId;
  /** Owning company (0 = public, e.g. city-owned export center). */
  owner: CompanyId;
  /** Optional custom name. */
  name: string | null;
  /** Top-left tile of the footprint. */
  x: number;
  y: number;
  /** Footprint size in tiles (after rotation). */
  w: number;
  h: number;
  /** Rotation 0..3 (×90°). Affects w/h swap and entrance side. */
  rotation: 0 | 1 | 2 | 3;
  /** totalDays when placed. */
  builtDay: number;
  /** 0..1; 1 = construction finished. */
  constructionProgress: number;
  /** Owner toggle; disabled buildings don't produce but still pay reduced upkeep. */
  enabled: boolean;
  /** Upgrade level (1 = base). Scales capacity/output. */
  level: number;
  /** Installed upgrade ids (from BuildingDef.upgrades). */
  upgrades: string[];
  /** Selected recipe (null for non-producing buildings). */
  recipeId: RecipeId | null;
  /** Progress of the current production cycle 0..1. */
  progress: number;
  /** Consumed goods: factory inputs, shop goods for sale. */
  input: Stock;
  /** Produced goods waiting for pickup (raw/factory output, byproducts). */
  output: Stock;
  /** Generic storage for warehouses/hubs/stations/export (mixed goods). */
  storage: Stock;
  /** Workforce. */
  workers: WorkforceState;
  /** Last computed overall efficiency 0..1+ (workers × tech × condition × weather). */
  efficiency: number;
  /** Physical condition 0..1 (ageing, disasters). < 0.3 = frequent breakdowns. */
  condition: number;
  status: BuildingStatus;
  /** Nearest/served city (shops, workforce source). 0 = none. */
  cityId: CityId;
  /** Delivery priority 1..5 (5 = highest), used when goods are scarce. */
  priority: number;
  /** Shop-specific settings (category 'shop'). */
  shop: ShopConfig | null;
  /** Hub/warehouse settings (category 'warehouse' | 'station' | 'export'). */
  hub: HubConfig | null;
  /** Statistics for inspector & charts. */
  stats: BuildingStats;
}

export interface WorkforceState {
  /** Workers required at full efficiency (from def × level, minus automation). */
  required: number;
  /** Workers currently employed. */
  employed: number;
  /** Monthly wage per worker. */
  wage: number;
  /** Average skill 0..1 (training raises it). */
  skill: number;
  /** City the workers commute from (0 = none in range). */
  sourceCityId: CityId;
  /** Automation level 0..1 reduces required workers (research). */
  automation: number;
}

export interface ShopConfig {
  /** Price multiplier vs local market price (0.5..2). */
  priceFactor: number;
  /** Products this shop is allowed to sell (empty = all its def allows). */
  assortment: ProductId[];
}

export interface HubConfig {
  /** Accepted products ('all' = anything). */
  accept: ProductId[] | 'all';
  /** Units per product kept in reserve (not handed out). */
  reserve: ProductAmounts;
  /** Max units per product (0/absent = def capacity). */
  limits: ProductAmounts;
  /** Buildings linked for distribution / station catchment. */
  linked: BuildingId[];
}

export interface BuildingStats {
  /** Current-month accumulators. */
  producedMonth: ProductAmounts;
  consumedMonth: ProductAmounts;
  soldMonth: ProductAmounts;
  revenueMonth: number;
  costMonth: number;
  /** Monthly history (oldest first, max HISTORY_MONTHS). */
  profitHistory: number[];
  /** Average utilization (0..1) per month. */
  utilizationHistory: number[];
  /** Lifetime totals. */
  totalProduced: number;
  totalRevenue: number;
}

// ============================================================================
// Vehicles & routes
// ============================================================================

export type VehicleStatus =
  | 'idle' // no route
  | 'moving' // travelling along path
  | 'loading'
  | 'unloading'
  | 'waiting' // waiting for cargo (waitFull) or congestion
  | 'noPath' // cannot reach next stop
  | 'broken' // breakdown, repairing
  | 'depot' // parked / servicing
  | 'stopped'; // manually stopped

export interface Vehicle {
  id: VehicleId;
  /** VehicleDef id. */
  typeId: VehicleTypeId;
  owner: CompanyId;
  /** Copied from def for fast filtering. */
  mode: TransportMode;
  name: string;
  /** Assigned route (null = idle). */
  routeId: RouteId | null;
  /** Index of the route stop we're heading to / at. */
  stopIndex: number;
  status: VehicleStatus;
  /** Current path as tile indices (from pathfinding); [] when stationary. */
  path: TileIndex[];
  /** Index of the path tile we're leaving (0..path.length-1). */
  pathIndex: number;
  /** Progress 0..1 from path[pathIndex] to path[pathIndex+1]. */
  pathProgress: number;
  /** Position in tile units (float, tile center = x+0.5). Written by logistics each tick. */
  x: number;
  y: number;
  /** Position at previous tick (render interpolates prev → current using sim alpha). */
  prevX: number;
  prevY: number;
  /** Heading in radians (0 = east, clockwise, screen coords). */
  heading: number;
  /** Current speed in tiles/day (after congestion, weather, condition). */
  speed: number;
  /** Goods on board. Total qty <= capacity. */
  cargo: Stock;
  /** Capacity override (e.g. train with wagons); from def when not changed. */
  capacity: number;
  /** Train wagons count (rail only; 0 for others). */
  wagons: number;
  /** Days remaining for current load/unload/wait/repair action. */
  timer: number;
  /** Age in days. */
  ageDays: number;
  /** 0..1, degrades with age/distance; low = breakdowns. */
  condition: number;
  /** Year of purchase. */
  builtYear: number;
  /** Home depot/station building (0 = none). */
  depotId: BuildingId;
  stats: VehicleStats;
}

export interface VehicleStats {
  tripsMonth: number;
  deliveredMonth: number; // units
  revenueMonth: number;
  costMonth: number;
  /** Tiles travelled this month. */
  distanceMonth: number;
  profitHistory: number[];
  totalDelivered: number;
}

export interface RouteOrder {
  action: 'load' | 'unload';
  /** Products affected ('all' = any compatible product). */
  products: ProductId[] | 'all';
  /** Max units for this order (0 = unlimited). */
  limit: number;
}

export interface RouteStop {
  buildingId: BuildingId;
  orders: RouteOrder[];
  /** Wait at this stop until cargo is full (or minLoad reached). */
  waitFull: boolean;
  /** Fraction 0..1 of capacity to wait for when waitFull. */
  minLoad: number;
}

export interface Route {
  id: RouteId;
  owner: CompanyId;
  name: string;
  mode: TransportMode;
  /** Display color (CSS) for map lines. */
  color: string;
  stops: RouteStop[];
  /** Vehicles assigned (kept in sync with Vehicle.routeId). */
  vehicleIds: VehicleId[];
  /** 1..5 (5 = highest). Higher priority routes load first from shared buildings. */
  priority: number;
  enabled: boolean;
  /** Created automatically by auto-connect / AI. */
  auto: boolean;
  createdDay: number;
  stats: RouteStats;
}

export interface RouteStats {
  tripsMonth: number;
  deliveredMonth: ProductAmounts;
  revenueMonth: number;
  costMonth: number;
  profitHistory: number[];
  /** Units delivered per month (history). */
  throughputHistory: number[];
}

// ============================================================================
// Cities
// ============================================================================

export type CityTier = 'village' | 'town' | 'city' | 'metropolis';

export interface City {
  id: CityId;
  name: string;
  /** Center tile. */
  x: number;
  y: number;
  /** Approx urban radius in tiles (grows with population). */
  radius: number;
  tier: CityTier;
  foundedYear: number;
  /** Population by social class. Total = poor + middle + rich. */
  population: Record<SocialClass, number>;
  /** Monthly growth rate (e.g. 0.01 = +1%/month), from satisfaction/jobs/pollution. */
  growthRate: number;
  /** Overall satisfaction 0..1 (weighted demand satisfaction, pollution, jobs). */
  satisfaction: number;
  /** Per product demand/supply state. Only products the city currently wants. */
  demand: Record<ProductId, CityDemand>;
  /** Class preference multipliers per product (≥0). Missing = 1. */
  preferences: ProductAmounts;
  /** 0..1 how much citizens value green products / low pollution. */
  greenPreference: number;
  /** Tiles with houses (indices), maintained by city growth. */
  houses: TileIndex[];
  labour: LabourPool;
  /** City opinion of each company −100..100 (pollution, supply, jobs). */
  opinion: Record<CompanyId, number>;
  /** Permits per company. Missing = 'granted'. */
  permits: Record<CompanyId, 'granted' | 'restricted' | 'denied'>;
  /** Has sea access (port city). */
  isPort: boolean;
  /** Weather region index. */
  regionId: number;
  history: {
    population: number[];
    satisfaction: number[];
  };
}

export interface CityDemand {
  /** Units wanted per month right now. */
  monthly: number;
  /** Units supplied (sold by shops) this month — accumulator. */
  suppliedMonth: number;
  /** Smoothed satisfaction ratio 0..1 (supplied / demand). */
  satisfaction: number;
  /** Local price per unit (market price × local factor). */
  price: number;
  /** Units supplied per company this month (market share). */
  shareByCompany: Record<CompanyId, number>;
  /** Satisfaction history (monthly). */
  history: number[];
}

export interface LabourPool {
  /** Working-age people. */
  workforce: number;
  /** Employed by any company. */
  employed: number;
  /** Average monthly wage in this city. */
  wage: number;
  /** Average skill 0..1 (education). */
  skill: number;
  /** Commute radius in tiles for buildings hiring from this city. */
  commuteRadius: number;
}

// ============================================================================
// Market
// ============================================================================

export interface MarketFlow {
  /** Units offered/produced. */
  supply: number;
  /** Units demanded (cities + factories). */
  demand: number;
  /** Units actually sold. */
  sold: number;
}

export interface MarketProduct {
  /** Current reference price per unit. */
  price: number;
  /** Base price from ProductDef (× priceIndex). */
  basePrice: number;
  /** Export price (export center / ports), usually < price. */
  exportPrice: number;
  /** Seasonal multiplier currently applied. */
  seasonal: number;
  /** Trend −1..1 (price direction) for UI arrows. */
  trend: number;
  /** Current month accumulators. */
  current: MarketFlow;
  /** Last closed month. */
  last: MarketFlow;
  priceHistory: number[];
  supplyHistory: number[];
  demandHistory: number[];
}

export interface MarketState {
  products: Record<ProductId, MarketProduct>;
  /** General price level / inflation index (1 = start). */
  priceIndex: number;
  /** Base annual interest rate for loans. */
  interestRate: number;
  /** Global economic climate multiplier (boom > 1 > recession). */
  economyFactor: number;
}

// ============================================================================
// Ecology, events, weather
// ============================================================================

export interface EcologyState {
  /** Global CO2-eq emitted this month (accumulator). */
  co2Month: number;
  /** Total emitted since start. */
  co2Total: number;
  co2History: number[];
  /** Fraction of tile pollution removed per day. */
  pollutionDecay: number;
  /** Carbon tax per emission unit (0 = none). */
  carbonTax: number;
  /** Public environmental awareness 0..1 (grows with era & pollution). */
  awareness: number;
  regulations: Regulation[];
}

export type RegulationKind = 'emissionCap' | 'carbonTax' | 'productBan' | 'subsidy' | 'permitRule' | 'minWage';

export interface Regulation {
  id: string;
  kind: RegulationKind;
  title: string;
  description: string;
  /** Target product / building category if applicable. */
  productId: ProductId | null;
  category: string | null;
  value: number;
  sinceDay: number;
  /** null = permanent. */
  untilDay: number | null;
}

export type WorldEventKind =
  | 'drought'
  | 'flood'
  | 'storm'
  | 'earthquake'
  | 'fire'
  | 'heatwave'
  | 'blizzard'
  | 'strike'
  | 'boom'
  | 'recession'
  | 'priceShock'
  | 'subsidy'
  | 'carbonTax'
  | 'emissionNorm'
  | 'epidemic'
  | 'festival'
  | 'custom';

export interface WorldEvent {
  id: WorldEventId;
  kind: WorldEventKind;
  title: string;
  description: string;
  icon: string;
  startDay: number;
  endDay: number;
  /** Affected area (null = global). */
  area: { x: number; y: number; radius: number } | null;
  regionIds: number[];
  cityId: CityId;
  productId: ProductId | null;
  companyId: CompanyId;
  /** Strength 0..1+. */
  magnitude: number;
  /** Effect values, same key convention as Company.modifiers (e.g. "efficiency.farm": 0.6). */
  effects: Record<string, number>;
}

export interface EventsState {
  active: WorldEvent[];
  /** Ended events, newest last, max MAX_EVENT_HISTORY. */
  history: WorldEvent[];
  /** Next day (totalDays) to roll for random events. */
  nextRollDay: number;
  /** Per-kind cooldown: kind -> earliest day it may happen again. */
  cooldowns: Partial<Record<WorldEventKind, number>>;
}

export interface RegionWeather {
  kind: WeatherKind;
  climate: ClimateZone;
  /** °C */
  temperature: number;
  /** 0..1 */
  precipitation: number;
  /** 0..1 */
  wind: number;
  /** 0..1 accumulated drought (farms suffer), reset by rain. */
  drought: number;
  /** Days left for current weather. */
  daysLeft: number;
}

export interface WeatherState {
  /** Region size in tiles (square). regionIndex = floor(y/size)*cols + floor(x/size). */
  regionSize: number;
  cols: number;
  rows: number;
  regions: RegionWeather[];
}

// ============================================================================
// Notifications, goals, advisor, blueprints, stats, view
// ============================================================================

export interface Notification {
  id: NotificationId;
  /** totalDays when created. */
  day: number;
  level: NotificationLevel;
  title: string;
  text: string;
  icon: string;
  /** Clicking focuses this target (optional). */
  target: EntityRef | null;
  /** Company the message concerns (0 = everyone; UI shows player + 0). */
  companyId: CompanyId;
  read: boolean;
  /** Category for filtering ('production', 'logistics', 'finance', 'city', 'event', 'research', 'goal', 'ai'). */
  category: string;
}

export interface NotificationsState {
  /** Newest last, max MAX_NOTIFICATIONS. */
  list: Notification[];
}

export type ObjectiveKind =
  | 'cash'
  | 'companyValue'
  | 'profitMonth'
  | 'produce' // produce N units of product (lifetime or within scenario)
  | 'deliver' // deliver N units of product to city
  | 'supplyCity' // reach X satisfaction for product in city
  | 'population'
  | 'research'
  | 'buildings'
  | 'vehicles'
  | 'reputation'
  | 'ecoRating'
  | 'marketShare'
  | 'custom';

export interface Objective {
  id: string;
  kind: ObjectiveKind;
  title: string;
  description: string;
  productId: ProductId | null;
  cityId: CityId;
  techId: TechId | null;
  target: number;
  /** Current value (updated by goals system). */
  progress: number;
  /** totalDays deadline (null = none). */
  deadlineDay: number | null;
  optional: boolean;
  done: boolean;
  failed: boolean;
  /** Cash reward on completion. */
  reward: number;
}

export interface GoalsState {
  scenarioId: ScenarioId | null;
  objectives: Objective[];
  /** Sandbox milestones achieved: milestoneId -> totalDays. */
  milestones: Record<string, number>;
  status: 'playing' | 'won' | 'lost';
  endedDay: number | null;
}

export interface AdvisorState {
  enabled: boolean;
  /** Tutorial step index (−1 = no tutorial). */
  tutorialStep: number;
  /** Tips already shown: tipId -> totalDays. */
  tipsShown: Record<string, number>;
  lastTipDay: number;
}

export interface BlueprintItem {
  typeId: BuildingTypeId;
  /** Offset from blueprint origin. */
  dx: number;
  dy: number;
  rotation: 0 | 1 | 2 | 3;
  recipeId: RecipeId | null;
}

export interface Blueprint {
  id: BlueprintId;
  name: string;
  /** Bounding box size in tiles. */
  w: number;
  h: number;
  items: BlueprintItem[];
  /** Road/rail pieces: offset + kind. */
  network: { dx: number; dy: number; road: number; rail: number }[];
  createdDay: number;
}

export interface StatsState {
  /**
   * Monthly series (oldest first, max HISTORY_MONTHS). Key convention:
   *  "company.<id>.cash" | "company.<id>.value" | "company.<id>.profit"
   *  "world.population" | "world.co2" | "market.<productId>.price" …
   */
  monthly: Record<string, number[]>;
  /** Daily series (max HISTORY_DAYS), same key convention. */
  daily: Record<string, number[]>;
}

export interface ViewState {
  /** Camera center in world px. */
  camX: number;
  camY: number;
  zoom: number;
  /** Active overlay/heatmap id (null = none). */
  overlay: string | null;
}
