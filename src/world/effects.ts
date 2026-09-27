/**
 * World-event effect queries (pure). Events live in state.events.active and carry
 * `effects` keyed like company modifiers ("<effect>.<target>").
 *
 * Scope of an event:
 *  - cityId ≠ 0          → that city (and tiles within its radius)
 *  - area ≠ null         → tiles within area.radius of area.x/y
 *  - regionIds non-empty → tiles in those weather regions
 *  - none of the above   → global (everywhere)
 */
import type { CityId, GameState, WorldEvent } from '../core/types';

export interface EffectLocation {
  x: number;
  y: number;
}

function regionOf(state: GameState, x: number, y: number): number {
  const w = state.weather;
  const cx = Math.min(w.cols - 1, Math.max(0, Math.floor(x / w.regionSize)));
  const cy = Math.min(w.rows - 1, Math.max(0, Math.floor(y / w.regionSize)));
  return cy * w.cols + cx;
}

export const isGlobalEvent = (ev: WorldEvent): boolean => !ev.cityId && !ev.area && ev.regionIds.length === 0;

/** Does the event apply at a location / to a city? (null loc + 0 city = only global events) */
export function eventApplies(state: GameState, ev: WorldEvent, loc: EffectLocation | null, cityId: CityId = 0): boolean {
  if (isGlobalEvent(ev)) return true;
  if (ev.cityId) {
    if (cityId && ev.cityId === cityId) return true;
    const c = state.cities[ev.cityId];
    if (c && loc && Math.hypot(loc.x - c.x, loc.y - c.y) <= c.radius + 1) return true;
  }
  if (ev.area) {
    const c = cityId ? state.cities[cityId] : undefined;
    const p = loc ?? (c ? { x: c.x, y: c.y } : null);
    if (p && Math.hypot(p.x - ev.area.x, p.y - ev.area.y) <= ev.area.radius) return true;
  }
  if (ev.regionIds.length > 0) {
    const c = cityId ? state.cities[cityId] : undefined;
    const p = loc ?? (c ? { x: c.x, y: c.y } : null);
    if (p && ev.regionIds.includes(regionOf(state, p.x, p.y))) return true;
  }
  return false;
}

/** Product of multiplicative effects `key` of active events applying here (1 = neutral). */
export function eventModifier(state: GameState, key: string, loc: EffectLocation | null = null, cityId: CityId = 0): number {
  let m = 1;
  for (const ev of state.events.active) {
    const v = ev.effects[key];
    if (v === undefined) continue;
    if (eventApplies(state, ev, loc, cityId)) m *= v;
  }
  return m;
}

/** Sum of additive effects `key` (e.g. "satisfaction", "carbonTax", "subsidy.<productId>"). */
export function eventAdditive(state: GameState, key: string, loc: EffectLocation | null = null, cityId: CityId = 0): number {
  let s = 0;
  for (const ev of state.events.active) {
    const v = ev.effects[key];
    if (v === undefined) continue;
    if (eventApplies(state, ev, loc, cityId)) s += v;
  }
  return s;
}
