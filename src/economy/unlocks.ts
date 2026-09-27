/**
 * Content gating: eras + technologies → what a company may build / run / buy.
 *
 * A def (building, vehicle, product) is unlocked for a company when
 *   era index(def.era) <= companyEraIndex(company)  AND  (no requiresTech OR tech researched)
 * or when a researched tech explicitly unlocks it (unlockX effect).
 * Recipes have no era: they are unlocked unless `requiresTech` is missing.
 * Company era = max(global calendar era, highest `era` tech the company researched).
 */
import type { GameContext } from '../core/context';
import type { UnlockKind } from '../core/services';
import type { Company, GameState, TechId } from '../core/types';
import type { TechDef } from '../data/defs';
import type { DataRegistry } from '../data/registry';
import { ERA_EARLY_YEARS } from './constants';

export function hasTech(company: Company | undefined, techId: TechId): boolean {
  return !!company && company.research.unlocked[techId] !== undefined;
}

/** Era index the company operates in. */
export function companyEraIndex(state: GameState, data: DataRegistry, company: Company | undefined): number {
  let idx = Math.max(0, data.eraIndex(state.time.eraId));
  if (!company) return idx;
  for (const techId in company.research.unlocked) {
    const t = data.techs[techId];
    if (!t) continue;
    for (const e of t.effects) if (e.kind === 'era') idx = Math.max(idx, data.eraIndex(e.id));
  }
  return idx;
}

function explicitlyUnlocked(data: DataRegistry, company: Company | undefined, kind: UnlockKind, id: string): boolean {
  if (!company) return false;
  const want = kind === 'building' ? 'unlockBuilding' : kind === 'vehicle' ? 'unlockVehicle' : kind === 'product' ? 'unlockProduct' : 'unlockRecipe';
  for (const techId in company.research.unlocked) {
    const t = data.techs[techId];
    if (t && t.effects.some((e) => e.kind === want && e.id === id)) return true;
  }
  return false;
}

/** Rule-based unlock check (does not rely on the company.unlocks cache). */
export function isUnlockedFor(state: GameState, data: DataRegistry, company: Company | undefined, kind: UnlockKind, id: string, eraIdx?: number): boolean {
  const def =
    kind === 'building' ? data.buildings[id] : kind === 'vehicle' ? data.vehicles[id] : kind === 'product' ? data.products[id] : data.recipes[id];
  if (!def) return false;
  const era = 'era' in def ? (def as { era: string }).era : null;
  if (era !== null) {
    const idx = eraIdx ?? companyEraIndex(state, data, company);
    if (data.eraIndex(era) > idx) return false;
  }
  const req = def.requiresTech;
  if (!req) return true;
  if (!company) return false;
  return hasTech(company, req) || explicitlyUnlocked(data, company, kind, id);
}

/** Rebuild company.unlocks (derived cache for UI). */
export function rebuildUnlocks(state: GameState, data: DataRegistry, company: Company): void {
  const eraIdx = companyEraIndex(state, data, company);
  const u: Company['unlocks'] = { buildings: {}, products: {}, recipes: {}, vehicles: {} };
  for (const b of data.buildingList()) if (isUnlockedFor(state, data, company, 'building', b.id, eraIdx)) u.buildings[b.id] = true;
  for (const p of data.productList()) if (isUnlockedFor(state, data, company, 'product', p.id, eraIdx)) u.products[p.id] = true;
  for (const r of Object.values(data.recipes)) if (isUnlockedFor(state, data, company, 'recipe', r.id, eraIdx)) u.recipes[r.id] = true;
  for (const v of data.vehicleList()) if (isUnlockedFor(state, data, company, 'vehicle', v.id, eraIdx)) u.vehicles[v.id] = true;
  company.unlocks = u;
}

export function rebuildAllUnlocks(state: GameState, data: DataRegistry): void {
  for (const c of Object.values(state.companies)) rebuildUnlocks(state, data, c);
}

/** Can the company start researching this tech now? Returns a Polish reason or null. */
export function researchBlocker(state: GameState, data: DataRegistry, company: Company, tech: TechDef): string | null {
  if (hasTech(company, tech.id)) return 'Technologia już opracowana';
  const missing = tech.prereqs.filter((p) => !hasTech(company, p));
  if (missing.length) return `Wymaga: ${missing.map((p) => data.techs[p]?.name ?? p).join(', ')}`;
  if (data.eraIndex(tech.era) > companyEraIndex(state, data, company)) return `Dostępne w epoce: ${data.eras[tech.era]?.name ?? tech.era}`;
  // An era technology can be researched at most ERA_EARLY_YEARS before the era's calendar
  // start: research lets you get there earlier, but a rich company can no longer drag the
  // whole world (and its wages) from 1850 into the digital era within 30 years.
  for (const e of tech.effects) {
    if (e.kind !== 'era') continue;
    const from = (data.eras[e.id]?.startYear ?? 0) - ERA_EARLY_YEARS;
    if (state.time.year < from) return `Dostępne od roku ${from}`;
  }
  return null;
}

/**
 * Apply a finished tech to a company: record, multiply modifiers, era jump
 * (player advances the world era), rebuild unlocks, emit events.
 */
export function applyTech(ctx: GameContext, company: Company, tech: TechDef): void {
  const state = ctx.state;
  if (hasTech(company, tech.id)) return;
  company.research.unlocked[tech.id] = state.time.totalDays;
  for (const e of tech.effects) {
    if (e.kind === 'modifier') {
      const cur = company.modifiers[e.key] ?? 1;
      company.modifiers[e.key] = cur * e.value;
    } else if (e.kind === 'era' && company.isPlayer) {
      const next = ctx.data.eras[e.id];
      if (next && ctx.data.eraIndex(e.id) > ctx.data.eraIndex(state.time.eraId)) {
        const previous = state.time.eraId;
        state.time.eraId = e.id;
        ctx.bus.emit('era:changed', { eraId: e.id, previous });
        ctx.bus.emit('sfx', { id: 'era' });
      }
    }
  }
  if (tech.effects.some((e) => e.kind === 'era' && company.isPlayer)) rebuildAllUnlocks(state, ctx.data);
  else rebuildUnlocks(state, ctx.data, company);
  ctx.bus.emit('research:completed', { companyId: company.id, techId: tech.id });
}
