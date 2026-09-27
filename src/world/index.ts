/**
 * world module — procedural map, cities, weather, world events.
 * Owner: world+cities agent. Planned files: mapgen.ts, cities.ts, weather.ts, events.ts.
 *
 * Expected registrations in init():
 *  - ctx.newGame.register('mapgen', NewGameStepOrder.mapgen, …)   (replaces core placeholder)
 *  - ctx.newGame.register('cities', NewGameStepOrder.cities, …)
 *  - ctx.newGame.register('weather', NewGameStepOrder.weather, …)
 *  - ctx.sim.registerSystem('weather', SystemOrder.weather, …, { period: 'day' })
 *  - ctx.sim.registerSystem('events',  SystemOrder.events,  …, { period: 'day' })
 *  - ctx.sim.registerSystem('cities',  SystemOrder.cities,  …)
 *  - Object.assign(ctx.services.world, { … })  (WorldService)
 */
import type { GameContext } from '../core/context';

export function init(ctx: GameContext): void {
  void ctx;
}
