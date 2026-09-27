/**
 * logistics module — road/rail network, pathfinding, vehicles, routes, hubs.
 * Owner: logistics agent. Planned files: network.ts, pathfinding.ts, vehicles.ts,
 * routes.ts, hubs.ts, tools/ (road, rail, route tools registered via ctx.input.registerTool).
 *
 * Expected registrations in init():
 *  - ctx.sim.registerSystem('logistics', SystemOrder.logistics, …)  (tick)
 *  - ctx.services.logistics = { … } (LogisticsService)
 *  - tools: 'road', 'rail', 'route' + toolbar buttons (group 'logistics' / 'transport')
 *  - rebuild path caches on 'game:started' and 'network:changed'
 */
import type { GameContext } from '../core/context';

export function init(ctx: GameContext): void {
  void ctx;
}
