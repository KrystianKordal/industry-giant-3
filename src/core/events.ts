/**
 * EventBus event map. Key = event name ("domain:action"), value = payload.
 * Add new events here (additive change + CONTRACTS.md changelog entry).
 *
 * Emitter column in comments = which module is expected to emit it.
 */
import type {
  BuildingId,
  BuildingTypeId,
  CityId,
  CompanyId,
  EntityRef,
  EraId,
  FinanceCategory,
  GameSpeed,
  GameState,
  NotificationLevel,
  ProductId,
  RouteId,
  Season,
  TechId,
  TileIndex,
  VehicleId,
  WorldEventId,
} from './types';

/** Selection payload used by 'select' (inspect tool → UI inspector). */
export type Selection = EntityRef | { kind: 'none' };

export interface GameEvents {
  // ------------------------------------------------------------ lifecycle (core)
  /** A new game state was created and installed (after all newGame steps). */
  'game:new': { state: GameState };
  /** A saved game was loaded and installed. Rebuild runtime caches here. */
  'game:loaded': { state: GameState };
  /** Emitted for BOTH new & loaded games, after game:new / game:loaded. Generic "state replaced" hook. */
  'game:started': { state: GameState };
  /** Game left (back to main menu). Drop references to the old state. */
  'game:ended': Record<string, never>;
  /** About to serialize — write view/camera or flush accumulators into state. */
  'game:beforeSave': { state: GameState };
  'game:saved': { slot: string };
  /** Scenario finished (game module). */
  'game:won': { reason: string };
  'game:lost': { reason: string };

  // ------------------------------------------------------------ time (core/sim)
  /** After every sim tick (dtDays = 1/TICKS_PER_DAY). Keep handlers cheap! */
  'time:tick': { tick: number };
  /** A new day started (state.time already shows the new date). */
  'time:day': { day: number; month: number; year: number; totalDays: number };
  /** A new month started (previous month has just closed). */
  'time:month': { month: number; year: number };
  'time:year': { year: number };
  'time:season': { season: Season };
  /** Speed or pause changed. */
  'time:speed': { speed: GameSpeed; paused: boolean };
  /** Era changed (economy/research or calendar). */
  'era:changed': { eraId: EraId; previous: EraId };

  // ------------------------------------------------------------ map & network
  /** Tiles changed (terrain, forest, houses, deposits…) → renderer invalidates chunks. */
  'map:changed': { x: number; y: number; w: number; h: number };
  /** Road/rail changed on tiles (logistics) → path caches + render invalidation. */
  'network:changed': { kind: 'road' | 'rail' | 'water'; tiles: TileIndex[] };

  // ------------------------------------------------------------ buildings
  'building:built': { buildingId: BuildingId };
  /** Construction finished (constructionProgress reached 1). */
  'building:completed': { buildingId: BuildingId };
  /** Removed; entity no longer in state.buildings. */
  'building:removed': { buildingId: BuildingId; typeId: BuildingTypeId; owner: CompanyId; x: number; y: number; w: number; h: number };
  /** Settings changed (recipe, enabled, upgrade, owner, name). */
  'building:changed': { buildingId: BuildingId };
  'building:statusChanged': { buildingId: BuildingId; status: string; previous: string };
  /** Production cycle finished (for SFX/animation). */
  'building:produced': { buildingId: BuildingId; productId: ProductId; qty: number };

  // ------------------------------------------------------------ vehicles & routes
  'vehicle:bought': { vehicleId: VehicleId };
  'vehicle:sold': { vehicleId: VehicleId; owner: CompanyId };
  'vehicle:arrived': { vehicleId: VehicleId; buildingId: BuildingId };
  'vehicle:delivered': { vehicleId: VehicleId; buildingId: BuildingId; productId: ProductId; qty: number; value: number };
  'vehicle:broken': { vehicleId: VehicleId };
  'route:created': { routeId: RouteId };
  'route:changed': { routeId: RouteId };
  'route:removed': { routeId: RouteId };

  // ------------------------------------------------------------ economy
  /** Any cash change via core/money.ts. amount is signed. */
  'cash:changed': { companyId: CompanyId; cash: number; amount: number; category: FinanceCategory };
  /** Goods sold to a city by a shop (economy/cities). */
  'sale': { companyId: CompanyId; buildingId: BuildingId; cityId: CityId; productId: ProductId; qty: number; revenue: number };
  /** Monthly market update done. */
  'market:updated': Record<string, never>;
  'company:created': { companyId: CompanyId };
  'company:bankrupt': { companyId: CompanyId };
  'research:started': { companyId: CompanyId; techId: TechId };
  'research:completed': { companyId: CompanyId; techId: TechId };

  // ------------------------------------------------------------ world
  'city:founded': { cityId: CityId };
  'city:grew': { cityId: CityId; population: number; previous: number };
  'worldEvent:started': { eventId: WorldEventId };
  'worldEvent:ended': { eventId: WorldEventId };
  'weather:changed': Record<string, never>;

  // ------------------------------------------------------------ goals / advisor
  'goal:completed': { objectiveId: string };
  'goal:failed': { objectiveId: string };
  'milestone': { id: string; title: string };
  'advisor:tip': { id: string; text: string; target: EntityRef | null };

  // ------------------------------------------------------------ ui / input / feedback
  /**
   * Show a toast. Emitted by core/notify.ts notify() (which also logs it into
   * state.notifications). UI listens and renders. Do not emit directly for
   * persistent messages — call notify().
   */
  'notify': { level: NotificationLevel; title: string; text: string; icon: string; target: EntityRef | null; companyId: CompanyId };
  /** Play a sound effect (audio). x/y = tile position for positional/contextual volume. */
  'sfx': { id: SfxId; x?: number; y?: number; volume?: number };
  /** Selection changed (inspect tool, lists, notifications). UI opens the inspector. */
  'select': Selection;
  /** Hovered tile changed (null = off-map). */
  'hover': { x: number; y: number } | null;
  'tool:changed': { toolId: string; previous: string };
  /** Camera moved/zoomed (throttled to once per frame). */
  'camera:changed': { x: number; y: number; zoom: number };
  /** Request camera to center on a tile (anyone may emit; renderer handles). */
  'camera:focus': { x: number; y: number; zoom?: number };
  'overlay:changed': { overlay: string | null };
  'panel:opened': { id: string };
  'panel:closed': { id: string };
  'settings:changed': Record<string, never>;
}

/**
 * Known SFX ids (audio module implements; unknown ids must be ignored silently).
 * Extend freely.
 */
export type SfxId =
  | 'click'
  | 'hover'
  | 'open'
  | 'close'
  | 'build'
  | 'demolish'
  | 'road'
  | 'rail'
  | 'cash'
  | 'error'
  | 'notify'
  | 'warning'
  | 'success'
  | 'research'
  | 'era'
  | 'truck'
  | 'train'
  | 'ship'
  | 'produce'
  | (string & {});
