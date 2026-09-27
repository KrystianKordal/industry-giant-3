/**
 * Regional weather (new-game step 'weather' + daily system 'weather').
 *
 * state.weather.regions[r] (RegionWeather) is updated daily: temperature follows
 * the season of the region's climate, weather kinds last a few days, drought
 * accumulates on dry warm days and is washed away by rain.
 *
 * Other modules read weather through modifiers (see weatherModifier / services.world.modifierAt):
 *   efficiency.farm  drought/heat/storm factor for farms (1 = normal)
 *   season.farm      seasonal growing factor (winter low; tropical ≈ 1)
 *   speed.water      storm 0.5, fog 0.8   (severe 'storm' WORLD EVENTS set 0 = blocked)
 *   speed.road       snow 0.75, storm 0.85, rain 0.95, fog 0.9
 *   speed.rail       snow 0.9, storm 0.95
 *   speed.air        storm 0, fog 0.6, snow 0.8
 */
import type { GameContext } from '../core/context';
import { rng, type Rng } from '../core/rng';
import { Terrain, type ClimateZone, type Difficulty, type GameState, type RegionWeather, type Season, type WeatherKind } from '../core/types';
import { clamp } from '../core/util';
import { worldExt } from './ext';

interface ClimateParams {
  /** Annual mean °C. */
  mean: number;
  /** Seasonal amplitude °C (July max, January min). */
  amp: number;
  /** Wetness 0..1 (rain frequency). */
  wet: number;
}

export const CLIMATE_PARAMS: Record<ClimateZone, ClimateParams> = {
  temperate: { mean: 9, amp: 10, wet: 0.45 },
  continental: { mean: 7, amp: 15, wet: 0.38 },
  arid: { mean: 22, amp: 9, wet: 0.12 },
  tropical: { mean: 26, amp: 3, wet: 0.6 },
  arctic: { mean: -6, amp: 12, wet: 0.3 },
};

export const WEATHER_NAMES: Record<WeatherKind, string> = {
  clear: 'Słonecznie',
  cloudy: 'Pochmurno',
  rain: 'Deszcz',
  storm: 'Burza',
  snow: 'Śnieg',
  heat: 'Upał',
  fog: 'Mgła',
};
export const WEATHER_ICONS: Record<WeatherKind, string> = { clear: '☀️', cloudy: '☁️', rain: '🌧️', storm: '⛈️', snow: '❄️', heat: '🔥', fog: '🌫️' };

const DROUGHT_MUL: Record<Difficulty, number> = { easy: 0.7, normal: 1, hard: 1.3 };

/** Seasonal target temperature for a climate at a (fractional) month 1..12. */
export function seasonalTemperature(climate: ClimateZone, month: number): number {
  const p = CLIMATE_PARAMS[climate];
  return p.mean + p.amp * Math.cos((2 * Math.PI * (month - 7)) / 12);
}

function seasonOfMonth(month: number): Season {
  return month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'autumn' : 'winter';
}

/** Weighted roll of the next weather kind. */
export function rollWeatherKind(r: Rng, region: RegionWeather, season: Season): WeatherKind {
  const p = CLIMATE_PARAMS[region.climate];
  const T = region.temperature;
  const wet = p.wet * (region.drought > 0.5 ? 0.6 : 1);
  const stormSeason = season === 'summer' ? 1.5 : season === 'autumn' ? 1.3 : 1;
  const weights: [WeatherKind, number][] = [
    ['clear', 1.2 - p.wet],
    ['cloudy', 0.3],
    ['rain', T > 1 ? wet : 0],
    ['snow', T <= 1 ? wet : 0],
    ['storm', (0.04 + 0.06 * p.wet) * stormSeason],
    ['fog', season === 'autumn' || season === 'winter' ? 0.14 : 0.06],
    ['heat', T > 24 ? 0.3 : 0],
  ];
  return r.weighted(weights, (w) => w[1])?.[0] ?? 'clear';
}

function durationFor(r: Rng, kind: WeatherKind): number {
  return kind === 'storm' ? r.int(1, 3) : kind === 'fog' ? r.int(1, 2) : kind === 'heat' ? r.int(3, 7) : r.int(2, 6);
}

function applyKind(region: RegionWeather, kind: WeatherKind, r: Rng): void {
  region.kind = kind;
  region.precipitation = { clear: 0, cloudy: 0.2, rain: 0.7, storm: 1, snow: 0.6, heat: 0, fog: 0.1 }[kind];
  region.wind = clamp({ clear: 0.2, cloudy: 0.35, rain: 0.4, storm: 0.9, snow: 0.45, heat: 0.1, fog: 0.05 }[kind] + r.range(-0.1, 0.1), 0, 1);
}

/** New-game step: set up regions (climate from latitude + terrain composition). */
export function initWeather(state: GameState, ctx: GameContext): void {
  const map = state.map;
  const w = state.weather;
  const W = map.width;
  const H = map.height;
  const r = rng(worldExt(state).rng);
  const month = state.time.month;
  w.regions = [];
  for (let ry = 0; ry < w.rows; ry++)
    for (let rx = 0; rx < w.cols; rx++) {
      let land = 0;
      let desert = 0;
      let snow = 0;
      let forest = 0;
      for (let y = ry * w.regionSize; y < Math.min(H, (ry + 1) * w.regionSize); y++)
        for (let x = rx * w.regionSize; x < Math.min(W, (rx + 1) * w.regionSize); x++) {
          const t = map.terrain[y * W + x]!;
          if (t === Terrain.Water || t === Terrain.DeepWater) continue;
          land++;
          if (t === Terrain.Desert) desert++;
          else if (t === Terrain.Snow) snow++;
          else if (t === Terrain.Forest || t === Terrain.Swamp) forest++;
        }
      let climate: ClimateZone = map.climate;
      const lat = (ry + 0.5) / w.rows; // 0 north .. 1 south
      if (land > 0 && desert / land > 0.25) climate = 'arid';
      else if (land > 0 && snow / land > 0.3) climate = 'arctic';
      else if (climate === 'temperate' && lat < 0.2 && w.rows > 2) climate = 'continental';
      else if (climate === 'arid' && land > 0 && forest / land > 0.35) climate = 'temperate';
      const region: RegionWeather = {
        kind: 'clear',
        climate,
        temperature: Math.round(seasonalTemperature(climate, month) + r.range(-2, 2)),
        precipitation: 0,
        wind: 0.2,
        drought: climate === 'arid' ? 0.5 : r.range(0, 0.15),
        daysLeft: r.int(1, 5),
      };
      applyKind(region, rollWeatherKind(r, region, state.time.season), r);
      w.regions.push(region);
    }
  void ctx;
}

/** Daily weather update. Returns true if any region's kind changed. */
export function updateWeatherDaily(state: GameState, ctx: GameContext): boolean {
  const ext = worldExt(state);
  const r = rng(ext.rng);
  const month = state.time.month + (state.time.day - 1) / 30;
  const season = seasonOfMonth(state.time.month);
  const dm = DROUGHT_MUL[state.settings.difficulty] ?? 1;
  let changed = false;
  for (const region of state.weather.regions) {
    const target = seasonalTemperature(region.climate, month);
    const offset = region.kind === 'heat' ? 6 : region.kind === 'snow' ? -3 : region.kind === 'clear' && season === 'summer' ? 2 : region.kind === 'rain' ? -1 : 0;
    region.temperature = Math.round((region.temperature * 0.7 + (target + offset + r.normal() * 2.5) * 0.3) * 10) / 10;
    if (--region.daysLeft <= 0) {
      const prev = region.kind;
      applyKind(region, rollWeatherKind(r, region, season), r);
      region.daysLeft = durationFor(r, region.kind);
      if (region.kind !== prev) changed = true;
    }
    // Drought accumulation.
    const T = region.temperature;
    let dd = 0;
    switch (region.kind) {
      case 'clear':
      case 'heat':
        dd = 0.012 * dm * (T > 18 ? 1.5 : T > 8 ? 1 : 0.3) * (region.climate === 'arid' ? 1.5 : 1) * (region.kind === 'heat' ? 1.5 : 1);
        break;
      case 'cloudy':
        dd = 0.002 * dm;
        break;
      case 'rain':
        dd = -0.06;
        break;
      case 'storm':
        dd = -0.1;
        break;
      case 'snow':
        dd = -0.03;
        break;
      default:
        dd = 0;
    }
    region.drought = Math.round(clamp(region.drought + dd, region.climate === 'arid' ? 0.35 : 0, 1) * 1000) / 1000;
  }
  if (changed) ctx.bus.emit('weather:changed', {});
  return changed;
}

/** Region weather at a tile (null without regions). */
export function weatherAt(state: GameState, x: number, y: number): RegionWeather | null {
  const w = state.weather;
  if (!w.regions.length) return null;
  const cx = Math.min(w.cols - 1, Math.max(0, Math.floor(x / w.regionSize)));
  const cy = Math.min(w.rows - 1, Math.max(0, Math.floor(y / w.regionSize)));
  return w.regions[cy * w.cols + cx] ?? null;
}

/** Multiplicative modifier from the region's current weather (1 = neutral). */
export function weatherModifier(state: GameState, key: string, region: RegionWeather | null): number {
  if (!region) return 1;
  const k = region.kind;
  switch (key) {
    case 'efficiency.farm': {
      const drought = 1 - (0.6 * Math.max(0, region.drought - 0.3)) / 0.7;
      const kindF = k === 'heat' ? 0.9 : k === 'storm' ? 0.85 : 1;
      return clamp(drought * kindF, 0.2, 1);
    }
    case 'season.farm': {
      if (region.climate === 'tropical') return 1;
      const s = seasonOfMonth(state.time.month);
      const T = region.temperature;
      const base = s === 'winter' ? 0.35 : s === 'spring' ? 0.9 : s === 'summer' ? 1.15 : 1;
      return clamp(base * (T < 0 ? 0.6 : 1), 0.1, 1.3);
    }
    case 'speed.water':
      return k === 'storm' ? 0.5 : k === 'fog' ? 0.8 : 1;
    case 'speed.road':
      return k === 'snow' ? 0.75 : k === 'storm' ? 0.85 : k === 'rain' ? 0.95 : k === 'fog' ? 0.9 : 1;
    case 'speed.rail':
      return k === 'snow' ? 0.9 : k === 'storm' ? 0.95 : 1;
    case 'speed.air':
      return k === 'storm' ? 0 : k === 'fog' ? 0.6 : k === 'snow' ? 0.8 : 1;
    default:
      return 1;
  }
}
