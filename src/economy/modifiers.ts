/**
 * Modifier resolution for buildings: company tech modifiers × installed
 * upgrades × active world events.
 *
 * Targets of a building (in order): its type id, category, tags, 'all'.
 * company.modifiers["<effect>.<target>"] values for ALL matching targets are
 * multiplied (unlike core getModifier which picks one). 1 = neutral.
 */
import type { Building, Company, GameState, WorldEvent } from '../core/types';
import type { BuildingDef } from '../data/defs';

export function buildingTargets(def: BuildingDef): string[] {
  return [def.id, def.category, ...(def.tags ?? []), 'all'];
}

/** Product of company modifiers `<effect>.<t>` over targets. */
export function companyMod(company: Company | undefined, effect: string, targets: readonly string[]): number {
  if (!company) return 1;
  const m = company.modifiers;
  let v = 1;
  for (const t of targets) {
    const x = m[`${effect}.${t}`];
    if (x !== undefined && Number.isFinite(x)) v *= x;
  }
  return v;
}

/** Product of installed upgrade effects `effect`. */
export function upgradeMod(b: Building, def: BuildingDef, effect: string): number {
  if (!b.upgrades.length || !def.upgrades) return 1;
  let v = 1;
  for (const id of b.upgrades) {
    const u = def.upgrades.find((x) => x.id === id);
    const x = u?.effects[effect];
    if (x !== undefined && Number.isFinite(x)) v *= x;
  }
  return v;
}

function regionOf(state: GameState, x: number, y: number): number {
  const w = state.weather;
  if (!w || !w.cols) return 0;
  const cx = Math.min(w.cols - 1, Math.max(0, Math.floor(x / w.regionSize)));
  const cy = Math.min(w.rows - 1, Math.max(0, Math.floor(y / w.regionSize)));
  return cy * w.cols + cx;
}

/** Does a world event apply to a building (scope: company, city, area, regions; none = global)? */
export function eventAppliesTo(state: GameState, ev: WorldEvent, b: Building): boolean {
  if (ev.companyId && ev.companyId !== b.owner) return false;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const scoped = !!ev.cityId || !!ev.area || ev.regionIds.length > 0;
  if (!scoped) return true;
  if (ev.cityId) {
    if (b.cityId === ev.cityId) return true;
    const c = state.cities[ev.cityId];
    if (c && Math.hypot(cx - c.x, cy - c.y) <= c.radius + 1) return true;
  }
  if (ev.area && Math.hypot(cx - ev.area.x, cy - ev.area.y) <= ev.area.radius) return true;
  if (ev.regionIds.length && ev.regionIds.includes(regionOf(state, cx, cy))) return true;
  return false;
}

/** Product of active world-event effects `<effect>.<t>` applying to the building. */
export function eventMod(state: GameState, b: Building, effect: string, targets: readonly string[]): number {
  const list = state.events?.active;
  if (!list || !list.length) return 1;
  let v = 1;
  for (const ev of list) {
    let hit = false;
    for (const t of targets) if (ev.effects[`${effect}.${t}`] !== undefined) hit = true;
    if (!hit || !eventAppliesTo(state, ev, b)) continue;
    for (const t of targets) {
      const x = ev.effects[`${effect}.${t}`];
      if (x !== undefined && Number.isFinite(x)) v *= x;
    }
  }
  return v;
}

/** Sum of additive global/company event effects `key` (e.g. "carbonTax"). */
export function eventAdditiveFor(state: GameState, key: string, companyId = 0): number {
  let s = 0;
  for (const ev of state.events?.active ?? []) {
    const x = ev.effects[key];
    if (x === undefined || !Number.isFinite(x)) continue;
    if (ev.companyId && ev.companyId !== companyId) continue;
    s += x;
  }
  return s;
}

/** Full building multiplier for an effect: company × upgrades × events. */
export function buildingMod(state: GameState, b: Building, def: BuildingDef, effect: string): number {
  const targets = buildingTargets(def);
  return companyMod(state.companies[b.owner], effect, targets) * upgradeMod(b, def, effect) * eventMod(state, b, effect, targets);
}

/** Is a regulation active today? */
export function regulationActive(state: GameState, r: { sinceDay: number; untilDay: number | null }): boolean {
  const today = state.time.totalDays;
  return r.sinceDay <= today && (r.untilDay === null || r.untilDay >= today);
}

/**
 * Additive policy value: active regulations of `kind` (optionally for a product)
 * + event effects `key` of events that are NOT mirrored as a regulation
 * (world mirrors carbonTax/subsidy events as regulations with id "ev-<eventId>").
 */
export function policyAdditive(state: GameState, key: string, kind: string, productId: string | null = null, companyId = 0): number {
  let s = 0;
  const regs = state.ecology?.regulations ?? [];
  for (const r of regs) {
    if (r.kind !== kind || !regulationActive(state, r)) continue;
    if (productId !== null && r.productId !== null && r.productId !== productId) continue;
    if (productId === null && r.productId !== null) continue;
    if (Number.isFinite(r.value)) s += r.value;
  }
  for (const ev of state.events?.active ?? []) {
    const x = ev.effects[key];
    if (x === undefined || !Number.isFinite(x)) continue;
    if (ev.companyId && ev.companyId !== companyId) continue;
    if (regs.some((r) => r.id === `ev-${ev.id}`)) continue;
    s += x;
  }
  return s;
}

/** Product of GLOBAL (unscoped) event effects `key` (e.g. "economy", "price.all"). */
export function globalEventMod(state: GameState, key: string): number {
  let v = 1;
  for (const ev of state.events?.active ?? []) {
    if (ev.cityId || ev.area || ev.regionIds.length || ev.companyId) continue;
    const x = ev.effects[key];
    if (x !== undefined && Number.isFinite(x)) v *= x;
  }
  return v;
}
