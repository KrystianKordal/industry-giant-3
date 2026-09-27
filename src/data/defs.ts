/**
 * Declarative data-definition types (products, recipes, buildings, vehicles,
 * technologies, eras, deposits). All defs are plain JSON-compatible objects so
 * they can be loaded from mod packs. Text fields are Polish.
 *
 * Owned by the data/economy agent. Extend with OPTIONAL fields only, so mods and
 * other modules keep compiling.
 */
import type {
  BuildingTypeId,
  DepositTypeId,
  EraId,
  ProductId,
  RecipeId,
  SocialClass,
  TechId,
  TerrainId,
  TransportMode,
  VehicleTypeId,
} from '../core/types';

// ============================================================================
// Eras
// ============================================================================

export interface EraDef {
  id: EraId;
  /** Polish name, e.g. "Rewolucja przemysłowa". */
  name: string;
  /** Order 0..4. */
  index: number;
  startYear: number;
  description: string;
  /** Accent color for UI. */
  color: string;
  icon: string;
}

// ============================================================================
// Products
// ============================================================================

export type ProductCategory =
  | 'raw' // extracted: ore, coal, oil, wood…
  | 'agri' // farm output: grain, cattle, cotton…
  | 'material' // processed intermediates: steel, flour, fabric…
  | 'food' // consumer food
  | 'consumer' // consumer goods
  | 'luxury'
  | 'electronics'
  | 'energy'
  | 'waste' // byproducts / waste
  | 'digital';

/** Affects vehicle compatibility & transport cost. */
export type WeightClass = 'light' | 'normal' | 'heavy' | 'bulk' | 'liquid';

export interface ProductDef {
  id: ProductId;
  name: string;
  /** Emoji icon. */
  icon: string;
  category: ProductCategory;
  /** Era it becomes available (may additionally require tech). */
  era: EraId;
  /** Base price per unit (zł) at priceIndex 1. */
  basePrice: number;
  /** Extracted/grown (produced without inputs). */
  isRaw: boolean;
  weightClass: WeightClass;
  /** Eco-friendly product (reputation bonus, preferred by green consumers). */
  green?: boolean;
  /** Waste product (disposal cost unless recycled). */
  isWaste?: boolean;
  /** Days before it spoils (undefined = never). */
  perishableDays?: number;
  /** Consumed by cities: monthly units per 1000 people of each class. */
  consumption?: Partial<Record<SocialClass, number>>;
  /** 12 monthly demand/price multipliers (Jan..Dec). */
  seasonal?: number[];
  /** Map/chart color. */
  color?: string;
  requiresTech?: TechId;
  description?: string;
  /**
   * City demand multiplier per era index (0..4), e.g. coal for heating fades out
   * in later eras. Missing = 1 for every era. Used by economy/demand.ts.
   */
  eraDemand?: number[];
}

// ============================================================================
// Recipes
// ============================================================================

export interface RecipeIO {
  product: ProductId;
  /** Units per cycle. */
  qty: number;
}

export interface RecipeDef {
  id: RecipeId;
  name: string;
  inputs: RecipeIO[];
  /** Main outputs. */
  outputs: RecipeIO[];
  /** Byproducts / waste produced alongside outputs. */
  byproducts?: RecipeIO[];
  /** Game days per production cycle at efficiency 1. */
  days: number;
  /** Alternative recipe (cheaper/premium variant of a standard one). */
  alternative?: boolean;
  /**
   * Quality modifier added to averaged input quality (e.g. +0.15 premium,
   * −0.1 cheap). Output quality = clamp(avgInputQ + qualityModifier, 0, 1).
   */
  qualityModifier: number;
  requiresTech?: TechId;
  /** Energy consumed per cycle (MWh), optional. */
  energy?: number;
  description?: string;
}

// ============================================================================
// Buildings
// ============================================================================

export type BuildingCategory =
  | 'raw' // farms, mines, forestry, wells
  | 'factory'
  | 'shop'
  | 'warehouse' // hubs/warehouses
  | 'station' // truck depot, train station, port, airport
  | 'research'
  | 'recycling'
  | 'energy'
  | 'export'
  | 'hq';

export interface BuildingUpgradeDef {
  id: string;
  name: string;
  cost: number;
  /** Effects using modifier key convention, e.g. { "capacity": 1.5, "efficiency": 1.1 }. */
  effects: Record<string, number>;
  requiresTech?: TechId;
}

export interface BuildingDef {
  id: BuildingTypeId;
  name: string;
  icon: string;
  category: BuildingCategory;
  /** Footprint (rotation 0). */
  size: { w: number; h: number };
  /** Construction cost (zł). */
  cost: number;
  /** Monthly upkeep (zł), excluding wages. */
  upkeep: number;
  /** Workers required at level 1. */
  workers: number;
  era: EraId;
  /** Terrain types allowed under the footprint. */
  allowedTerrain: TerrainId[];
  /** Requires a deposit of this type under the footprint (mines, wells). */
  requiresDeposit?: DepositTypeId;
  /** Minimum average fertility 0..255 (farms). */
  minFertility?: number;
  /** Must touch water (ports) / coast. */
  requiresWater?: boolean;
  /** Recipes this building can run (first = default). */
  recipes: RecipeId[];
  /** Emissions (CO2-eq units) per month at full operation. */
  pollution: number;
  /** Storage capacity per product (input/output/storage buffers). */
  capacity: number;
  /** Game days to construct. */
  buildDays: number;
  /** Stations: which transport mode it serves. */
  stationMode?: TransportMode;
  /** Shops: products it can sell (empty/undefined = by category). */
  sells?: ProductId[];
  /** Service radius in tiles (shops: customers, stations: catchment). */
  radius?: number;
  /** Energy: MW produced (+) or consumed (−). */
  power?: number;
  /** Research points per month (labs). */
  researchPoints?: number;
  upgrades?: BuildingUpgradeDef[];
  requiresTech?: TechId;
  /**
   * Extra modifier targets / grouping tags (e.g. 'farm', 'mine', 'food',
   * 'textile', 'heavy', 'electronics', 'green'). Company modifiers
   * "<effect>.<tag>" apply to all buildings carrying the tag.
   */
  tags?: string[];
  /** Shops: product categories it sells (informative; `sells` is the authoritative list). */
  sellsCategories?: ProductCategory[];
  /** Shops / export: max units sold per day at efficiency 1. */
  salesPerDay?: number;
  /** Stations / hubs: units per day that can be loaded+unloaded (logistics hint). */
  loadRate?: number;
  /** Eco-friendly building (green energy, recycling): improves the company eco rating. */
  green?: boolean;
  /** Base draw color for the placeholder renderer. */
  color?: string;
  description?: string;
}

// ============================================================================
// Vehicles
// ============================================================================

export interface VehicleDef {
  id: VehicleTypeId;
  name: string;
  icon: string;
  mode: TransportMode;
  /** Cargo units. For trains: per wagon (see wagons). */
  capacity: number;
  /** Tiles per game day. */
  speed: number;
  /** Purchase cost (zł). */
  cost: number;
  /** Monthly upkeep (zł). */
  upkeep: number;
  era: EraId;
  requiresTech?: TechId;
  /** Weight classes it can carry (undefined = all). */
  cargo?: WeightClass[];
  /** Trains: wagon limits. */
  wagons?: { min: number; max: number; costPerWagon: number };
  /** Expected lifespan in years (condition degrades after). */
  lifespanYears: number;
  /** Emissions per tile travelled. */
  emissions: number;
  /** Draw color hint. */
  color?: string;
  description?: string;
}

// ============================================================================
// Technologies
// ============================================================================

export type TechEffect =
  | { kind: 'unlockBuilding'; id: BuildingTypeId }
  | { kind: 'unlockRecipe'; id: RecipeId }
  | { kind: 'unlockVehicle'; id: VehicleTypeId }
  | { kind: 'unlockProduct'; id: ProductId }
  /** Sets/multiplies a company modifier: key per convention "<effect>.<target>". */
  | { kind: 'modifier'; key: string; value: number }
  /** Advances the company to a new era (if calendar allows). */
  | { kind: 'era'; id: EraId };

export interface TechDef {
  id: TechId;
  name: string;
  icon: string;
  /** Research points needed. */
  cost: number;
  prereqs: TechId[];
  era: EraId;
  effects: TechEffect[];
  description: string;
}

// ============================================================================
// Deposits (map resources)
// ============================================================================

export interface DepositDef {
  id: DepositTypeId;
  name: string;
  icon: string;
  /** Raw product extracted from it. */
  product: ProductId;
  /** Terrains where mapgen may place it. */
  terrain: TerrainId[];
  /** Relative abundance weight for mapgen. */
  frequency: number;
  /** Typical units per tile (mapgen randomizes around it). */
  amount: number;
  /** Map overlay color. */
  color: string;
}

// ============================================================================
// Terrain metadata
// ============================================================================

export interface TerrainDef {
  id: TerrainId;
  name: string;
  /** Base render color. */
  color: string;
  buildable: boolean;
  isWater: boolean;
  /** Construction cost multiplier. */
  buildCost: number;
  /** Road/rail cost multiplier (Infinity = impossible without bridge/tunnel). */
  networkCost: number;
}

// ============================================================================
// Mods
// ============================================================================

/**
 * A mod pack (JSON). Entries with an existing id replace the base def,
 * new ids are added. Loaded via registry.mergeMod().
 */
export interface ModPack {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  eras?: EraDef[];
  products?: ProductDef[];
  recipes?: RecipeDef[];
  buildings?: BuildingDef[];
  vehicles?: VehicleDef[];
  techs?: TechDef[];
  deposits?: DepositDef[];
}
