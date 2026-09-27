/**
 * GameState construction: empty state factory + the new-game pipeline.
 *
 * New game = createEmptyState(options) → install as ctx.state → run registered
 * new-game steps in order. Steps (by convention, see NewGameStepOrder):
 *   100 mapgen    (world)     terrain, deposits, rivers   [core placeholder by default]
 *   200 cities    (world)     cities, houses, labour
 *   250 weather   (world)
 *   300 market    (economy)   market prices / unlocks / starting setup
 *   400 companies (economy)   player extras
 *   450 ai        (ai)        rival companies
 *   500 scenario  (game)      objectives, overrides
 * Registering a step with an existing name replaces it.
 */
import type { DataRegistry } from '../data/registry';
import { DEFAULT_USER_SETTINGS } from './settings';
import { GAME_VERSION, MAX_MAP_SIZE, MIN_MAP_SIZE, SAVE_VERSION } from './constants';
import type { GameContext } from './context';
import { createCompany, emptyFinanceMonth } from './entities';
import { placeholderMapgen } from './mapgenPlaceholder';
import { createRng, randomSeed } from './rng';
import { seasonOf } from './sim';
import {
  Terrain,
  type Difficulty,
  type GameState,
  type MapState,
  type MarketState,
  type NetworkState,
  type NewGameOptions,
  type WeatherState,
} from './types';
import { clamp } from './util';

export type NewGameStep = (state: GameState, options: NewGameOptions, ctx: GameContext) => void;

export const NewGameStepOrder = {
  mapgen: 100,
  cities: 200,
  weather: 250,
  market: 300,
  companies: 400,
  ai: 450,
  scenario: 500,
  final: 900,
} as const;

export class NewGameRegistry {
  private steps: { name: string; order: number; fn: NewGameStep }[] = [];

  constructor() {
    this.register('mapgen', NewGameStepOrder.mapgen, placeholderMapgen);
  }

  /** Add or replace (same name) a step. */
  register(name: string, order: number, fn: NewGameStep): void {
    this.steps = this.steps.filter((s) => s.name !== name);
    this.steps.push({ name, order, fn });
    this.steps.sort((a, b) => a.order - b.order);
  }
  unregister(name: string): void {
    this.steps = this.steps.filter((s) => s.name !== name);
  }
  list(): readonly { name: string; order: number; fn: NewGameStep }[] {
    return this.steps;
  }
}

export const START_CASH: Record<Difficulty, number> = { easy: 250_000, normal: 150_000, hard: 80_000 };

export function defaultNewGameOptions(): NewGameOptions {
  return {
    seed: randomSeed(),
    mapWidth: 128,
    mapHeight: 128,
    mapPreset: 'continent',
    waterLevel: 0.35,
    cityCount: 8,
    resourceAbundance: 1,
    difficulty: 'normal',
    rivals: 3,
    startYear: 1850,
    companyName: 'Moja Firma',
    companyColor: '#e8b04a',
    mode: 'sandbox',
    scenarioId: null,
    disasters: true,
    politicalEvents: true,
    startCash: null,
  };
}

// ---------------------------------------------------------------- sub-state factories
export function createMapState(width: number, height: number, seed: number): MapState {
  const n = width * height;
  return {
    width,
    height,
    seed,
    seaLevel: 0,
    climate: 'temperate',
    terrain: new Uint8Array(n).fill(Terrain.Grass),
    elevation: new Uint8Array(n),
    fertility: new Uint8Array(n),
    forest: new Uint8Array(n),
    flags: new Uint8Array(n),
    depositTypes: [''],
    deposit: new Uint8Array(n),
    depositAmount: new Float32Array(n),
    depositQuality: new Uint8Array(n),
    pollution: new Float32Array(n),
    building: new Uint32Array(n),
    city: new Uint16Array(n),
    house: new Uint8Array(n),
  };
}

export function createNetworkState(width: number, height: number): NetworkState {
  const n = width * height;
  return {
    road: new Uint8Array(n),
    roadConn: new Uint8Array(n),
    rail: new Uint8Array(n),
    railConn: new Uint8Array(n),
    owner: new Uint16Array(n),
    traffic: new Uint16Array(n),
    version: 0,
  };
}

export function createWeatherState(width: number, height: number, regionSize = 32): WeatherState {
  const cols = Math.ceil(width / regionSize);
  const rows = Math.ceil(height / regionSize);
  return {
    regionSize,
    cols,
    rows,
    regions: Array.from({ length: cols * rows }, () => ({
      kind: 'clear' as const,
      climate: 'temperate' as const,
      temperature: 10,
      precipitation: 0.3,
      wind: 0.2,
      drought: 0,
      daysLeft: 5,
    })),
  };
}

/** Market with every product at base price (economy may re-initialize). */
export function createMarketState(data: DataRegistry): MarketState {
  const products: MarketState['products'] = {};
  for (const p of data.productList()) {
    products[p.id] = {
      price: p.basePrice,
      basePrice: p.basePrice,
      exportPrice: p.basePrice * 0.7,
      seasonal: 1,
      trend: 0,
      current: { supply: 0, demand: 0, sold: 0 },
      last: { supply: 0, demand: 0, sold: 0 },
      priceHistory: [],
      supplyHistory: [],
      demandHistory: [],
    };
  }
  return { products, priceIndex: 1, interestRate: 0.06, economyFactor: 1 };
}

// ---------------------------------------------------------------- empty state
/** Build a fully-initialized empty GameState (map filled with grass, player company created). */
export function createEmptyState(opts: NewGameOptions, data: DataRegistry): GameState {
  const width = clamp(Math.round(opts.mapWidth), MIN_MAP_SIZE, MAX_MAP_SIZE);
  const height = clamp(Math.round(opts.mapHeight), MIN_MAP_SIZE, MAX_MAP_SIZE);
  const options: NewGameOptions = { ...opts, mapWidth: width, mapHeight: height };
  const now = new Date().toISOString();
  const era = data.eraForYear(options.startYear);
  const state: GameState = {
    version: SAVE_VERSION,
    meta: {
      id: `g${options.seed.toString(36)}-${Date.now().toString(36)}`,
      name: `${options.companyName} (${options.seed})`,
      createdAt: now,
      savedAt: '',
      playTimeSec: 0,
      gameVersion: GAME_VERSION,
    },
    settings: options,
    rng: createRng(options.seed ^ 0x9e3779b9),
    time: {
      tick: 0,
      totalDays: 0,
      dayFraction: 0,
      day: 1,
      month: 1,
      year: options.startYear,
      season: seasonOf(1),
      speed: 1,
      paused: false,
      eraId: era.id,
      startYear: options.startYear,
    },
    map: createMapState(width, height, options.seed),
    network: createNetworkState(width, height),
    nextIds: { building: 1, vehicle: 1, route: 1, city: 1, company: 1, notification: 1, loan: 1, event: 1 },
    playerCompanyId: 0,
    companies: {},
    buildings: {},
    vehicles: {},
    routes: {},
    cities: {},
    market: createMarketState(data),
    ecology: { co2Month: 0, co2Total: 0, co2History: [], pollutionDecay: 0.01, carbonTax: 0, awareness: 0.05, regulations: [] },
    events: { active: [], history: [], nextRollDay: 60, cooldowns: {} },
    weather: createWeatherState(width, height),
    notifications: { list: [] },
    goals: { scenarioId: options.scenarioId, objectives: [], milestones: {}, status: 'playing', endedDay: null },
    advisor: { enabled: DEFAULT_USER_SETTINGS.advisorEnabled, tutorialStep: -1, tipsShown: {}, lastTipDay: 0 },
    blueprints: {},
    stats: { monthly: {}, daily: {} },
    view: { camX: 0, camY: 0, zoom: 1, overlay: null },
    mods: [],
    ext: {},
  };
  const player = createCompany(state, {
    name: options.companyName,
    color: options.companyColor,
    isPlayer: true,
    cash: options.startCash ?? START_CASH[options.difficulty],
    logo: '🏭',
  });
  state.playerCompanyId = player.id;
  player.finances.current = emptyFinanceMonth(state.time.year, state.time.month);
  return state;
}

/**
 * Create a new game: empty state → install into ctx → run new-game steps.
 * Does NOT emit events or start the sim (see core/lifecycle.ts startNewGame).
 * During steps ctx.state already returns the new state.
 */
export function newGame(ctx: GameContext, partial: Partial<NewGameOptions> = {}): GameState {
  const options = { ...defaultNewGameOptions(), ...partial };
  const state = createEmptyState(options, ctx.data);
  const previous = ctx.tryState();
  ctx.setState(state);
  try {
    for (const step of ctx.newGame.list()) step.fn(state, state.settings, ctx);
  } catch (err) {
    ctx.setState(previous);
    throw err;
  }
  return state;
}
