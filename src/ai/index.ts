/**
 * ai module — rival companies. Owner: AI/game/audio agent. Planned: competitor.ts.
 *
 * Expected registrations in init():
 *  - ctx.newGame.register('ai', NewGameStepOrder.ai, …)  (create rivals: createCompany(..., ai: AIState))
 *  - ctx.sim.registerSystem('ai', SystemOrder.ai, …, { period: 'day' })
 *  - act only through ctx.services.* (economy.build, logistics.autoConnect, …)
 */
import type { GameContext } from '../core/context';

export function init(ctx: GameContext): void {
  void ctx;
}
