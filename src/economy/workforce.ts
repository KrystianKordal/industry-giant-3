/**
 * Workforce (daily, SystemOrder.workforce): buildings hire from cities whose
 * edge is within commute range; the nearest cities are used first. Writes
 * Building.workers (required/employed/wage/skill/sourceCityId/automation),
 * Building.cityId (main labour/customer city) and City.labour.employed.
 *
 * Buildings with no city in range hire RURAL_WORKER_SHARE of the crew at a
 * wage premium, so a remote farm or mine still works (slower).
 */
import type { GameContext } from '../core/context';
import type { Building, City, GameState } from '../core/types';
import { clamp } from '../core/util';
import type { BuildingDef } from '../data/defs';
import { BASE_WAGE_BY_ERA, COMMUTE_BONUS, RURAL_WAGE_MULT, RURAL_WORKER_SHARE } from './constants';
import { buildingMod, buildingTargets, companyMod, eventMod } from './modifiers';

export function baseWage(ctx: GameContext, state: GameState): number {
  const idx = Math.max(0, ctx.data.eraIndex(state.time.eraId));
  return BASE_WAGE_BY_ERA[Math.min(idx, BASE_WAGE_BY_ERA.length - 1)]!;
}

/** Workers the building needs now (def × upgrades × tech/event `workers.*`). */
export function requiredWorkers(state: GameState, b: Building, def: BuildingDef): number {
  if (def.workers <= 0) return 0;
  return Math.max(1, Math.round(def.workers * buildingMod(state, b, def, 'workers')));
}

/** Distance from building center to a city's edge (tiles, ≥ 0). */
export function distToCity(b: Building, c: City): number {
  const d = Math.hypot(b.x + b.w / 2 - c.x, b.y + b.h / 2 - c.y);
  return Math.max(0, d - c.radius);
}

export function workforceSystem(state: GameState, _dt: number, ctx: GameContext): void {
  const cities = Object.values(state.cities);
  const free = new Map<number, number>();
  for (const c of cities) {
    c.labour.employed = 0;
    free.set(c.id, Math.max(0, c.labour.workforce));
  }
  const fallbackWage = baseWage(ctx, state);
  const list = Object.values(state.buildings).sort((a, b) => b.priority - a.priority || a.id - b.id);
  for (const b of list) {
    const def = ctx.data.buildings[b.typeId];
    if (!def) continue;
    const company = state.companies[b.owner];
    const required = requiredWorkers(state, b, def);
    const targets = buildingTargets(def);
    const autoMul = companyMod(company, 'workers', targets) * eventMod(state, b, 'workers', targets);
    b.workers.required = required;
    b.workers.automation = clamp(1 - autoMul, 0, 1);

    // nearest cities in commute range
    const inRange: { c: City; d: number }[] = [];
    let nearest: { c: City; d: number } | null = null;
    for (const c of cities) {
      const d = distToCity(b, c);
      if (!nearest || d < nearest.d) nearest = { c, d };
      if (d <= c.labour.commuteRadius + COMMUTE_BONUS) inRange.push({ c, d });
    }
    inRange.sort((a, z) => a.d - z.d || a.c.id - z.c.id);
    b.cityId = inRange[0]?.c.id ?? (nearest && nearest.d <= 40 ? nearest.c.id : 0);

    const working = b.constructionProgress >= 1 && b.enabled && company && !company.bankrupt;
    if (!working || required === 0) {
      b.workers.employed = 0;
      b.workers.sourceCityId = inRange[0]?.c.id ?? 0;
      if (b.workers.wage <= 0) b.workers.wage = inRange[0]?.c.labour.wage || fallbackWage;
      continue;
    }

    const wageMul = companyMod(company, 'wages', targets) * eventMod(state, b, 'wages', targets);
    if (inRange.length === 0) {
      b.workers.employed = Math.round(required * RURAL_WORKER_SHARE);
      b.workers.wage = Math.round(fallbackWage * RURAL_WAGE_MULT * wageMul * 100) / 100;
      b.workers.skill = 0.35;
      b.workers.sourceCityId = 0;
      continue;
    }
    let need = required;
    let wageSum = 0;
    let skillSum = 0;
    let got = 0;
    for (const { c } of inRange) {
      if (need <= 0) break;
      const avail = free.get(c.id) ?? 0;
      const take = Math.min(avail, need);
      if (take <= 0) continue;
      free.set(c.id, avail - take);
      c.labour.employed += take;
      need -= take;
      got += take;
      wageSum += take * (c.labour.wage > 0 ? c.labour.wage : fallbackWage);
      skillSum += take * c.labour.skill;
    }
    b.workers.employed = got;
    b.workers.sourceCityId = inRange[0]!.c.id;
    b.workers.wage = Math.round((got > 0 ? wageSum / got : inRange[0]!.c.labour.wage || fallbackWage) * wageMul * 100) / 100;
    b.workers.skill = got > 0 ? Math.round((skillSum / got) * 1000) / 1000 : 0.4;
  }
}
