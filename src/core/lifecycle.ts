/**
 * Game lifecycle: start new / load / save / end, plus core systems
 * (era from calendar, basic stats sampling, autosave).
 *
 * Event order on start:  (steps run) → 'game:new' | 'game:loaded' → 'game:started'
 * Event order on end:    'game:ended' (state is null afterwards)
 */
import { AUTOSAVE_SLOT, saveToSlot } from './save';
import { HISTORY_DAYS, TILE_SIZE } from './constants';
import type { GameContext } from './context';
import { cityPopulation } from './entities';
import { notify } from './notify';
import { SystemOrder } from './sim';
import { newGame } from './state';
import type { GameState, NewGameOptions } from './types';
import { pushHistory } from './util';

/** Create and start a new game. */
export function startNewGame(ctx: GameContext, options: Partial<NewGameOptions> = {}): GameState {
  ctx.sim.stop();
  if (ctx.hasGame) ctx.bus.emit('game:ended', {});
  const state = newGame(ctx, options);
  state.view.camX = (state.map.width * TILE_SIZE) / 2;
  state.view.camY = (state.map.height * TILE_SIZE) / 2;
  state.view.zoom = 1;
  ctx.bus.emit('game:new', { state });
  ctx.bus.emit('game:started', { state });
  if (!ctx.headless) ctx.sim.start();
  return state;
}

/** Install a deserialized state (from save.ts) and start it. */
export function startLoadedGame(ctx: GameContext, state: GameState): void {
  ctx.sim.stop();
  if (ctx.hasGame) ctx.bus.emit('game:ended', {});
  for (const mod of state.mods) ctx.data.mergeMod(mod);
  ctx.setState(state);
  ctx.bus.emit('game:loaded', { state });
  ctx.bus.emit('game:started', { state });
  if (!ctx.headless) ctx.sim.start();
}

/** Leave the current game (back to menu). */
export function endGame(ctx: GameContext): void {
  ctx.sim.stop();
  if (!ctx.hasGame) return;
  ctx.bus.emit('game:ended', {});
  ctx.setState(null);
}

/** Save current game into a slot (emits game:beforeSave / game:saved). */
export async function saveGame(ctx: GameContext, slot: string): Promise<void> {
  const state = ctx.state;
  ctx.bus.emit('game:beforeSave', { state });
  await saveToSlot(state, slot);
  ctx.bus.emit('game:saved', { slot });
}

/** Register systems/listeners owned by core. Called once by main.ts (and test contexts that want them). */
export function installCore(ctx: GameContext): void {
  // Era follows the calendar (research may unlock content, but the era label is time-driven).
  ctx.sim.registerSystem(
    'core.era',
    SystemOrder.era,
    (state, _dt, c) => {
      const era = c.data.eraForYear(state.time.year);
      if (era.id !== state.time.eraId && c.data.eraIndex(era.id) > c.data.eraIndex(state.time.eraId)) {
        const previous = state.time.eraId;
        state.time.eraId = era.id;
        c.bus.emit('era:changed', { eraId: era.id, previous });
        c.bus.emit('sfx', { id: 'era' });
        notify(c, { level: 'success', icon: era.icon, title: `Nowa epoka: ${era.name}`, text: era.description, category: 'research' });
      }
    },
    { period: 'year' },
  );

  // Basic time series for charts. Modules add their own keys (see StatsState docs).
  ctx.sim.registerSystem(
    'core.stats.daily',
    SystemOrder.stats,
    (state) => {
      for (const c of Object.values(state.companies)) {
        pushHistory((state.stats.daily[`company.${c.id}.cash`] ??= []), c.cash, HISTORY_DAYS);
      }
    },
    { period: 'day' },
  );
  ctx.sim.registerSystem(
    'core.stats.monthly',
    SystemOrder.stats,
    (state) => {
      for (const c of Object.values(state.companies)) {
        pushHistory((state.stats.monthly[`company.${c.id}.cash`] ??= []), c.cash);
        pushHistory((state.stats.monthly[`company.${c.id}.value`] ??= []), c.finances.valuation);
      }
      let pop = 0;
      for (const city of Object.values(state.cities)) pop += cityPopulation(city);
      pushHistory((state.stats.monthly['world.population'] ??= []), pop);
    },
    { period: 'month' },
  );

  // Autosave every N months (user setting).
  let monthsSinceSave = 0;
  ctx.bus.on('game:started', () => {
    monthsSinceSave = 0;
  });
  ctx.bus.on('time:month', () => {
    const every = ctx.userSettings.autosaveMonths;
    if (ctx.headless || every <= 0 || !ctx.hasGame) return;
    if (++monthsSinceSave < every) return;
    monthsSinceSave = 0;
    saveGame(ctx, AUTOSAVE_SLOT).catch((err: unknown) =>
      notify(ctx, { level: 'warning', title: 'Autozapis nieudany', text: err instanceof Error ? err.message : String(err), silent: false }),
    );
  });
}
