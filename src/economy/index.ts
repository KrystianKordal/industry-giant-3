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
import { NewGameStepOrder } from '../core/state';
import { SystemOrder } from '../core/sim';
import type { Company, GameState } from '../core/types';
import { TAX_RATE } from './constants';
import { closeEcologyMonth, ecologyDailySystem } from './ecology';
import { econExt } from './ext';
import { closeFinanceMonth, financeDailySystem, refreshCompanyFinance } from './finance';
import { closeMarketMonth, ensureMarket, marketNewGameStep } from './market';
import { productionDailySystem, productionSystem, resetProductionCaches } from './production';
import { researchSystem } from './research';
import { salesSystem } from './sales';
import { createEconomyService } from './service';
import { rebuildAllUnlocks, rebuildUnlocks } from './unlocks';
import { workforceSystem } from './workforce';

export * as analysis from './analysis';

/** One-time setup of a company for the economy (tax rate, unlocks, credit). Safe to call repeatedly. */
export function initCompany(ctx: GameContext, state: GameState, c: Company, fresh: boolean): void {
  if (fresh) c.finances.taxRate = TAX_RATE[state.settings.difficulty] ?? 0.19;
  if (!Number.isFinite(c.research.budget) || c.research.budget < 0) c.research.budget = 0;
  rebuildUnlocks(state, ctx.data, c);
  refreshCompanyFinance(ctx, c);
}

export function monthCloseSystem(state: GameState, _dt: number, ctx: GameContext): void {
  closeMarketMonth(state, ctx);
  closeEcologyMonth(state, ctx);
  closeFinanceMonth(state, ctx);
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

  ctx.bus.on('game:started', ({ state }) => {
    resetProductionCaches();
    econExt(state);
    ensureMarket(state, ctx);
    for (const c of Object.values(state.companies)) initCompany(ctx, state, c, false);
  });
  ctx.bus.on('game:ended', () => resetProductionCaches());
  ctx.bus.on('company:created', ({ companyId }) => {
    const state = ctx.tryState();
    const c = state?.companies[companyId];
    if (state && c) initCompany(ctx, state, c, c.foundedDay === state.time.totalDays);
  });
  ctx.bus.on('era:changed', () => {
    const state = ctx.tryState();
    if (state) rebuildAllUnlocks(state, ctx.data);
  });
}
