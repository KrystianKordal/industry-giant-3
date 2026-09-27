/**
 * Research (daily, SystemOrder.research).
 *
 * Points per month = BASE_RESEARCH_POINTS + Σ labs (def.researchPoints ×
 * efficiency × upgrade `research`) + budget / ZL_PER_RESEARCH_POINT, all ×
 * company `research.all`. The budget (company.research.budget, zł/month) is
 * only spent while something is being researched. When `current` completes,
 * effects are applied (economy/unlocks.ts applyTech) and the next queued tech
 * starts. Switching tech keeps partial progress (state.ext.economy.researchPartial).
 */
import type { GameContext } from '../core/context';
import type { ActionResult } from '../core/services';
import { DAYS_PER_MONTH } from '../core/constants';
import { addMoney } from '../core/money';
import { notify } from '../core/notify';
import type { Company, CompanyId, GameState, TechId } from '../core/types';
import { BASE_RESEARCH_POINTS, ZL_PER_RESEARCH_POINT } from './constants';
import { econExt } from './ext';
import { companyMod, upgradeMod } from './modifiers';
import { applyTech, hasTech, researchBlocker } from './unlocks';

/** Research points per month from labs/HQ (without budget). */
export function labPoints(ctx: GameContext, company: Company): number {
  const state = ctx.state;
  let pts = 0;
  for (const id in state.buildings) {
    const b = state.buildings[id]!;
    if (b.owner !== company.id || b.constructionProgress < 1 || !b.enabled) continue;
    const def = ctx.data.buildings[b.typeId];
    if (!def?.researchPoints) continue;
    if (b.status !== 'ok') continue;
    pts += def.researchPoints * Math.max(0, b.efficiency) * upgradeMod(b, def, 'research');
  }
  return pts;
}

/** Total research points per month incl. budget (derived; also stored in research.pointsPerMonth). */
export function researchPointsPerMonth(ctx: GameContext, company: Company, labs = labPoints(ctx, company), budget = company.research.budget): number {
  const budgetPts = Math.max(0, budget) / ZL_PER_RESEARCH_POINT;
  return (BASE_RESEARCH_POINTS + labs + budgetPts) * companyMod(company, 'research', ['all']);
}

function savePartial(state: GameState, company: Company): void {
  const r = company.research;
  if (!r.current || r.progress <= 0) return;
  const ext = econExt(state);
  (ext.researchPartial[company.id] ??= {})[r.current] = r.progress;
}

function begin(ctx: GameContext, company: Company, techId: TechId): void {
  const state = ctx.state;
  const ext = econExt(state);
  savePartial(state, company);
  company.research.current = techId;
  const partial = ext.researchPartial[company.id];
  company.research.progress = partial?.[techId] ?? 0;
  if (partial) delete partial[techId];
  company.research.queue = company.research.queue.filter((t) => t !== techId);
  ctx.bus.emit('research:started', { companyId: company.id, techId });
}

/** Service: start researching a tech now (current one is paused, its progress kept). */
export function startResearch(ctx: GameContext, companyId: CompanyId, techId: string): ActionResult {
  const state = ctx.state;
  const company = state.companies[companyId];
  if (!company) return { ok: false, reason: 'Nieznana firma' };
  const tech = ctx.data.techs[techId];
  if (!tech) return { ok: false, reason: 'Nieznana technologia' };
  if (company.research.current === techId) return { ok: true, cost: 0 };
  const why = researchBlocker(state, ctx.data, company, tech);
  if (why) return { ok: false, reason: why };
  begin(ctx, company, techId);
  return { ok: true, cost: 0 };
}

/** Add a tech (and its missing prerequisites, in order) to the queue. Starts immediately if idle. */
export function queueResearch(ctx: GameContext, companyId: CompanyId, techId: string): ActionResult {
  const state = ctx.state;
  const company = state.companies[companyId];
  const tech = ctx.data.techs[techId];
  if (!company || !tech) return { ok: false, reason: 'Nieznana technologia' };
  if (hasTech(company, techId)) return { ok: false, reason: 'Technologia już opracowana' };
  const order: TechId[] = [];
  const visit = (id: TechId): void => {
    if (hasTech(company, id) || order.includes(id)) return;
    const t = ctx.data.techs[id];
    if (!t) return;
    for (const p of t.prereqs) visit(p);
    order.push(id);
  };
  visit(techId);
  for (const id of order) if (id !== company.research.current && !company.research.queue.includes(id)) company.research.queue.push(id);
  if (!company.research.current) startNextQueued(ctx, company);
  return { ok: true, cost: 0 };
}

/** Stop researching (progress kept for later). */
export function cancelResearch(ctx: GameContext, companyId: CompanyId): void {
  const company = ctx.state.companies[companyId];
  if (!company) return;
  savePartial(ctx.state, company);
  company.research.current = null;
  company.research.progress = 0;
}

/** Start the first queued tech that is researchable now (drops ones already done). */
function startNextQueued(ctx: GameContext, company: Company): void {
  const r = company.research;
  r.queue = r.queue.filter((t) => !hasTech(company, t) && ctx.data.techs[t]);
  for (const t of r.queue) {
    const def = ctx.data.techs[t]!;
    if (!researchBlocker(ctx.state, ctx.data, company, def)) {
      begin(ctx, company, t);
      return;
    }
  }
}

export function researchSystem(state: GameState, _dt: number, ctx: GameContext): void {
  const ids = Object.keys(state.companies).map(Number).sort((a, z) => a - z);
  for (const id of ids) {
    const company = state.companies[id]!;
    const r = company.research;
    const labs = labPoints(ctx, company);
    r.pointsPerMonth = Math.round(researchPointsPerMonth(ctx, company, labs) * 10) / 10;
    if (company.bankrupt) continue;
    if (!r.current) startNextQueued(ctx, company);
    if (!r.current) continue;
    const tech = ctx.data.techs[r.current];
    if (!tech) {
      r.current = null;
      r.progress = 0;
      continue;
    }
    // budget spending (only while researching; not when broke)
    const budget = company.cash < 0 ? 0 : Math.max(0, r.budget);
    if (budget > 0) addMoney(ctx, company.id, -Math.round((budget / DAYS_PER_MONTH) * 100) / 100, 'research');
    const pts = researchPointsPerMonth(ctx, company, labs, budget) / DAYS_PER_MONTH;
    r.progress += pts;
    if (r.progress >= tech.cost) {
      const extra = r.progress - tech.cost;
      r.current = null;
      r.progress = 0;
      applyTech(ctx, company, tech);
      if (company.isPlayer) {
        notify(ctx, { level: 'success', icon: tech.icon, title: `Opracowano: ${tech.name}`, text: tech.description, companyId: company.id, category: 'research' });
        ctx.bus.emit('sfx', { id: 'research' });
      }
      startNextQueued(ctx, company);
      if (r.current) r.progress += extra;
    }
  }
}
