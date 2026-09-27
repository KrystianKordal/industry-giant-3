/**
 * economy module — production, shops/market, workforce, ecology, research,
 * finance. Owner: data+economy agent (also owns src/data/).
 *
 * Registrations (see docs/CONTRACTS.md "Ekonomia — API"):
 *  - systems:  economy.monthClose (month, 60)  — market prices, ecology (taxes, ratings,
 *                                                permits), finance close; runs FIRST in the
 *                                                new month so everything lands in the closed month
 *              workforce          (day, 200)
 *              production         (tick, 300)   production.daily (day, 301)
 *              market             (day, 500)    shop / export / digital sales
 *              ecology            (day, 600)    pollution spread + decay
 *              research           (day, 700)
 *              finance            (day, 800)    upkeep, wages, electricity
 *  - new-game steps: market (300), companies (400)
 *  - ctx.services.economy (service.ts)
 */
import type { GameContext } from '../core/context';
import { notify } from '../core/notify';
import { NewGameStepOrder } from '../core/state';
import { SystemOrder } from '../core/sim';
import type { Company, GameState } from '../core/types';
import { TAX_RATE } from './constants';
import { closeEcologyMonth, ecologyDailySystem } from './ecology';
import { econExt } from './ext';
import { closeFinanceMonth, financeDailySystem, refreshCompanyFinance } from './finance';
import { closeMarketMonth, ensureMarket, marketNewGameStep } from './market';
import { dumpProductionCaches, productionDailySystem, productionSystem, resetProductionCaches, restoreProductionCaches } from './production';
import { researchSystem } from './research';
import { salesSystem } from './sales';
import { createEconomyService, repairCost } from './service';
import { rebuildAllUnlocks, rebuildUnlocks } from './unlocks';
import { workforceSystem } from './workforce';

export * as analysis from './analysis';

/**
 * A company founded in a later era (sandbox start year / campaign 1900+) inherits
 * the technology of all earlier eras (e.g. railways in 1900) — silently, without
 * research events. Modifier effects are applied like applyTech does.
 */
function grantEarlierEraTechs(ctx: GameContext, state: GameState, c: Company): void {
  const startIdx = ctx.data.eraIndex(state.time.eraId);
  if (startIdx <= 0) return;
  for (const t of ctx.data.techList()) {
    if (ctx.data.eraIndex(t.era) >= startIdx || c.research.unlocked[t.id] !== undefined) continue;
    c.research.unlocked[t.id] = state.time.totalDays;
    for (const e of t.effects) if (e.kind === 'modifier') c.modifiers[e.key] = (c.modifiers[e.key] ?? 1) * e.value;
  }
}

/** One-time setup of a company for the economy (tax rate, unlocks, credit). Safe to call repeatedly. */
export function initCompany(ctx: GameContext, state: GameState, c: Company, fresh: boolean): void {
  if (fresh) c.finances.taxRate = TAX_RATE[state.settings.difficulty] ?? 0.19;
  if (fresh) grantEarlierEraTechs(ctx, state, c);
  if (!Number.isFinite(c.research.budget) || c.research.budget < 0) c.research.budget = 0;
  rebuildUnlocks(state, ctx.data, c);
  refreshCompanyFinance(ctx, c);
}

export function monthCloseSystem(state: GameState, _dt: number, ctx: GameContext): void {
  closeMarketMonth(state, ctx);
  closeEcologyMonth(state, ctx);
  closeFinanceMonth(state, ctx);
}

/**
 * When the world reaches an era (calendar or someone's research), every company gets that
 * era's `era_*` technology for free: it is only a gateway (prerequisite of the era's techs),
 * and without it a company that never researched it could not even start e.g. automation
 * research in 2020. Silent (no research events); other techs still need research.
 */
function grantReachedEraTechs(ctx: GameContext, state: GameState): void {
  const worldIdx = ctx.data.eraIndex(state.time.eraId);
  for (const t of ctx.data.techList()) {
    const eraEff = t.effects.find((e) => e.kind === 'era');
    if (!eraEff || eraEff.kind !== 'era' || ctx.data.eraIndex(eraEff.id) > worldIdx) continue;
    for (const c of Object.values(state.companies)) {
      if (c.research.unlocked[t.id] !== undefined) continue;
      c.research.unlocked[t.id] = state.time.totalDays;
      if (c.research.current === t.id) {
        c.research.current = null;
        c.research.progress = 0;
      }
      c.research.queue = c.research.queue.filter((q) => q !== t.id);
    }
  }
}

/** Era change: wages jump (world) faster than prices — point the player at automation research. */
function wageNotice(ctx: GameContext, state: GameState, eraId: string): void {
  const idx = ctx.data.eraIndex(eraId);
  if (idx < 2) return;
  const player = state.companies[state.playerCompanyId];
  if (!player) return;
  const next = ['automation_1', 'industrial_robots', 'robotics'].find((t) => player.research.unlocked[t] === undefined && ctx.data.techs[t]);
  if (!next) return;
  const tech = ctx.data.techs[next]!;
  notify(ctx, {
    level: 'info',
    icon: '💼',
    title: 'Płace rosną szybciej niż ceny',
    text: `Nowa epoka podnosi płace w miastach. Stare łańcuchy tracą marżę — zbadaj „${tech.name}” (mniej pracowników) albo przejdź na nowsze produkty.`,
    companyId: player.id,
    category: 'research',
  });
}

export function init(ctx: GameContext): void {
  Object.assign(ctx.services.economy, createEconomyService(ctx));

  const sim = ctx.sim;
  sim.registerSystem('economy.monthClose', SystemOrder.era + 10, monthCloseSystem, { period: 'month' });
  sim.registerSystem('workforce', SystemOrder.workforce, workforceSystem, { period: 'day' });
  sim.registerSystem('production', SystemOrder.production, productionSystem);
  sim.registerSystem('production.daily', SystemOrder.production + 1, productionDailySystem, { period: 'day' });
  sim.registerSystem('market', SystemOrder.market, salesSystem, { period: 'day' });
  sim.registerSystem('ecology', SystemOrder.ecology, ecologyDailySystem, { period: 'day' });
  sim.registerSystem('research', SystemOrder.research, researchSystem, { period: 'day' });
  sim.registerSystem('finance', SystemOrder.finance, financeDailySystem, { period: 'day' });

  ctx.newGame.register('market', NewGameStepOrder.market, (state) => marketNewGameStep(state, ctx));
  ctx.newGame.register('companies', NewGameStepOrder.companies, (state) => {
    econExt(state);
    for (const c of Object.values(state.companies)) initCompany(ctx, state, c, true);
  });

  ctx.bus.on('game:beforeSave', ({ state }) => {
    econExt(state).runtime = dumpProductionCaches();
  });
  ctx.bus.on('game:started', ({ state }) => {
    resetProductionCaches();
    const ext = econExt(state);
    restoreProductionCaches(ext.runtime);
    delete ext.runtime;
    ensureMarket(state, ctx);
    for (const c of Object.values(state.companies)) initCompany(ctx, state, c, false);
  });
  ctx.bus.on('game:ended', () => resetProductionCaches());
  ctx.bus.on('company:created', ({ companyId }) => {
    const state = ctx.tryState();
    const c = state?.companies[companyId];
    if (state && c) initCompany(ctx, state, c, c.foundedDay === state.time.totalDays);
  });
  // A building knocked below 25% condition stops completely — tell the owner how to fix it.
  ctx.bus.on('building:statusChanged', ({ buildingId, status }) => {
    if (status !== 'damaged' && status !== 'noDeposit') return;
    const state = ctx.tryState();
    const b = state?.buildings[buildingId];
    if (!state || !b || b.owner !== state.playerCompanyId) return;
    const def = ctx.data.buildings[b.typeId];
    if (status === 'noDeposit') {
      notify(ctx, {
        level: 'warning',
        icon: '⛏️',
        title: `Złoże wyczerpane: ${b.name ?? def?.name ?? b.typeId}`,
        text: 'Kopalnia nic już nie wydobywa. Postaw nową przy innym złożu (nakładka „Złoża”) i przepnij trasę, a starą wyburz.',
        target: { kind: 'building', id: b.id },
        companyId: b.owner,
        category: 'production',
      });
      return;
    }
    notify(ctx, {
      level: 'warning',
      icon: '🛠️',
      title: `Uszkodzony budynek: ${b.name ?? def?.name ?? b.typeId}`,
      text: `Stan ${Math.round(b.condition * 100)}% — budynek stoi. Naprawa (inspektor budynku → Napraw) kosztuje ok. ${repairCost(ctx, b)} zł.`,
      target: { kind: 'building', id: b.id },
      companyId: b.owner,
      category: 'production',
    });
  });
  ctx.bus.on('era:changed', ({ eraId }) => {
    const state = ctx.tryState();
    if (!state) return;
    grantReachedEraTechs(ctx, state);
    rebuildAllUnlocks(state, ctx.data);
    wageNotice(ctx, state, eraId);
  });
}
