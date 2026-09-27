/**
 * World module's private persistent data in state.ext.world (plain data only).
 */
import { createRng, hashSeed } from '../core/rng';
import type { GameState, RngState, TileIndex } from '../core/types';

export interface WorldExt {
  /** Dedicated RNG stream for weather & world events (does not disturb state.rng). */
  rng: RngState;
  /** Damaged road tiles and the day (totalDays) they get repaired. */
  repairs: { idx: TileIndex; day: number }[];
}

export function worldExt(state: GameState): WorldExt {
  let ext = state.ext.world as WorldExt | undefined;
  if (!ext || typeof ext !== 'object' || !ext.rng) {
    ext = { rng: createRng(hashSeed(state.settings.seed, 'world-events')), repairs: [] };
    state.ext.world = ext;
  }
  ext.repairs ??= [];
  return ext;
}
