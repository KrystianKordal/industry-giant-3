/**
 * game module — scenarios/campaign, goals & milestones, advisor/tutorial, blueprints.
 * Owner: AI/game/audio agent. Planned: scenarios.ts, goals.ts, advisor.ts, blueprints.ts.
 *
 * Expected registrations in init():
 *  - ctx.newGame.register('scenario', NewGameStepOrder.scenario, …)
 *  - systems 'goals' (SystemOrder.goals) and 'advisor' (SystemOrder.advisor)
 *  - Object.assign(ctx.services.game, { scenarios, currentHint })
 *  - panel 'campaign' (main menu button opens it)
 */
import type { GameContext } from '../core/context';

export function init(ctx: GameContext): void {
  void ctx;
}
