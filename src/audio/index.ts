/**
 * audio module — generative ambient music, UI SFX, contextual sounds (WebAudio).
 * Owner: AI/game/audio agent. Planned: audio.ts.
 *
 * Expected in init():
 *  - ctx.services.audio = { unlock, play, setMusic, applySettings }
 *  - ctx.bus.on('sfx', ({ id, x, y }) => …)  — ignore unknown ids
 *  - volumes from ctx.userSettings; react to 'settings:changed'
 *  - never create AudioContext before a user gesture (use unlock()).
 */
import type { GameContext } from '../core/context';

export function init(ctx: GameContext): void {
  if (ctx.headless) return;
}
