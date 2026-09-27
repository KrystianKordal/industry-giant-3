/**
 * world module — procedural map, cities, weather, world events.
 * Owner: world+cities agent. See docs/CONTRACTS.md "Świat — API".
 *
 * Registrations:
 *  - new-game steps: 'mapgen' (100, replaces core placeholder), 'cities' (200), 'weather' (250)
 *  - systems: 'weather' (day), 'events' (day), 'cities' (month)
 *  - ctx.services.world (WorldService)
 */
import type { GameContext } from '../core/context';
import { NewGameStepOrder } from '../core/state';
import { SystemOrder } from '../core/sim';
import type { GameState } from '../core/types';
import { createWorldService } from './api';
import { ChangeSet } from './changes';
import { citiesMonthlySystem, generateCities, pruneHouses, refreshAllDemand } from './cities';
import { eventsDailySystem } from './events';
import { worldExt } from './ext';
import { generateMap } from './mapgen';
import { initWeather, updateWeatherDaily } from './weather';

export { generateMap } from './mapgen';
export { modifierAt, isWaterBlocked, terrainCost, tilesInRadius, nearestCity } from './api';
export { eventModifier, eventAdditive, eventApplies } from './effects';
export { weatherAt, weatherModifier, WEATHER_NAMES, WEATHER_ICONS } from './weather';
export { TIER_NAMES, HOUSE_CAPACITY, cityWealth, supplyScore } from './cities';
export { rollWorldEvent } from './events';

export function init(ctx: GameContext): void {
  ctx.newGame.register('mapgen', NewGameStepOrder.mapgen, (state, options) => generateMap(state, options, ctx.data));
  ctx.newGame.register('cities', NewGameStepOrder.cities, (state, options) => generateCities(state, options, ctx));
  ctx.newGame.register('weather', NewGameStepOrder.weather, (state) => {
    worldExt(state);
    initWeather(state, ctx);
  });

  ctx.sim.registerSystem('weather', SystemOrder.weather, (state, _dt, c) => void updateWeatherDaily(state, c), { period: 'day' });
  ctx.sim.registerSystem('events', SystemOrder.events, (state, _dt, c) => eventsDailySystem(state, c), { period: 'day' });
  ctx.sim.registerSystem('cities', SystemOrder.cities, (state, _dt, c) => citiesMonthlySystem(state, c), { period: 'month' });

  Object.assign(ctx.services.world, createWorldService(ctx));

  // Market prices are set by later new-game steps → refresh local city prices once the game exists.
  ctx.bus.on('game:new', ({ state }) => refreshAllDemand(state, ctx.data));
  ctx.bus.on('game:loaded', ({ state }) => void worldExt(state));
  ctx.bus.on('era:changed', () => {
    const s = ctx.tryState();
    if (s) refreshAllDemand(s, ctx.data);
  });

  // Buildings / roads placed over houses replace them.
  ctx.bus.on('building:built', ({ buildingId }) => {
    const s = ctx.tryState();
    const b = s?.buildings[buildingId];
    if (!s || !b) return;
    let hit = false;
    for (let y = b.y; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++) if (s.map.house[y * s.map.width + x]) hit = true;
    if (hit) pruneAll(ctx, s);
  });
  ctx.bus.on('network:changed', ({ tiles }) => {
    const s = ctx.tryState();
    if (!s) return;
    if (tiles.some((i) => s.map.house[i]! > 0)) pruneAll(ctx, s);
  });
}

function pruneAll(ctx: GameContext, state: GameState): void {
  const cs = new ChangeSet();
  for (const c of Object.values(state.cities)) pruneHouses(state, c, cs);
  cs.flush(ctx);
}
