/**
 * economy module — production, market, finance, research, ecology, workforce.
 * Owner: data+economy agent (also owns src/data/). Planned files: production.ts,
 * market.ts, finance.ts, research.ts, ecology.ts, workforce.ts.
 *
 * Expected registrations in init():
 *  - systems: 'workforce' (SystemOrder.workforce), 'production', 'market', 'ecology',
 *    'research', 'finance' (monthly close: move finances.current → history, taxes, loans, bankruptcy)
 *  - ctx.newGame.register('market', NewGameStepOrder.market, …) (+ 'companies' for player unlocks)
 *  - ctx.services.economy = { … } (EconomyService: build, demolish, research, loans…)
 */
import type { GameContext } from '../core/context';

export function init(ctx: GameContext): void {
  void ctx;
}
