/**
 * Logistics balance constants (costs, capacities, speeds). Tweak here.
 */
import type { TransportMode } from '../core/types';

/** Construction cost per tile by RoadKind (index = level). */
export const ROAD_COST = [0, 60, 150, 420] as const;
/** Construction cost per tile by RailKind. */
export const RAIL_COST = [0, 320, 520, 950] as const;
/** Cost multiplier for bridges (tile over water / river). */
export const BRIDGE_MULT = { road: 6, rail: 8 } as const;
/** Max consecutive tiles of a bridge. */
export const MAX_BRIDGE_SPAN = 12;
/** Extra cost factor when clearing forest (tree density > 0). */
export const FOREST_CLEAR_MULT = 1.15;
/** Fraction of construction cost refunded on bulldoze. */
export const REFUND_RATE = 0.25;

/** Monthly upkeep per tile by level. Bridges cost ×BRIDGE_UPKEEP_MULT. */
export const ROAD_UPKEEP = [0, 0.4, 1.2, 3.5] as const;
export const RAIL_UPKEEP = [0, 2.5, 4, 7] as const;
export const BRIDGE_UPKEEP_MULT = 3;

/** Era index from which a network level is available (index = level). */
export const ROAD_LEVEL_ERA = [0, 0, 1, 3] as const;
export const RAIL_LEVEL_ERA = [0, 0, 2, 3] as const;
export const ROAD_LEVEL_NAMES = ['', 'Droga gruntowa', 'Droga utwardzona', 'Autostrada'] as const;
export const RAIL_LEVEL_NAMES = ['', 'Tor zwykły', 'Tor zelektryfikowany', 'Kolej dużych prędkości'] as const;

/** Speed multipliers of vehicles on a tile by road/rail level. */
export const ROAD_SPEED_MULT = [1, 0.8, 1, 1.35] as const;
export const RAIL_SPEED_MULT = [1, 1, 1.25, 1.7] as const;

/** Vehicles per tile before congestion slows traffic down. */
export const ROAD_CAPACITY = [2, 2, 4, 8] as const;
export const RAIL_CAPACITY = 1;
export const WATER_CAPACITY = 4;
/** Minimum speed factor under heavy congestion. */
export const MIN_CONGESTION_FACTOR = 0.25;

/** Default catchment radius (tiles around the footprint) of rail/water/air stations. */
export const DEFAULT_CATCHMENT = 4;
/** Max straight-line range between drone ports (tiles). */
export const DRONE_RANGE = 40;

/** Max vehicle path searches per sim tick (the rest retry next tick). */
export const PATH_BUDGET_PER_TICK = 24;
/** Max nodes expanded by one vehicle path search. */
export const MAX_SEARCH_NODES = 200_000;
/** Margin (tiles) of the search box when planning a new road/rail. */
export const PLAN_MARGIN = 40;

/** Loading/unloading time (days) = BASE + moved/capacity × PER_CAPACITY. */
export const LOAD_DAYS_BASE = 0.3;
export const LOAD_DAYS_PER_CAPACITY = 0.7;
/** Max days a vehicle waits for a full load before leaving anyway. */
export const MAX_WAIT_DAYS = 30;
/** Retry interval (days) for vehicles without a path. */
export const NO_PATH_RETRY_DAYS = 2;

/** Breakdowns: base daily chance + chance scaled by wear. */
export const BREAKDOWN_BASE = 0.0008;
export const BREAKDOWN_WEAR = 0.025;
/** Repair cost as a fraction of vehicle price. */
export const REPAIR_COST_FRACTION = 0.015;
/** Traffic counter daily decay factor. */
export const TRAFFIC_DECAY = 0.93;
/** Traffic counter value treated as "max" for overlays (0..1 normalization). */
export const TRAFFIC_REF = 400;

/** Route display palette (cycled by route id). */
export const ROUTE_COLORS = ['#e8b04a', '#4ac0e8', '#e85a4a', '#7be04a', '#c07be0', '#e87bb8', '#4ae0b0', '#e0e04a', '#8a9bff', '#ff9b5a'];

export const MODE_NAMES: Record<TransportMode, string> = {
  road: 'drogowy',
  rail: 'kolejowy',
  water: 'wodny',
  air: 'lotniczy',
};

export const MODE_ICONS: Record<TransportMode, string> = { road: '🚚', rail: '🚂', water: '🚢', air: '🛸' };
