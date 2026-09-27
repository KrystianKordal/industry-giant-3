import { Terrain } from '../core/types';
import type { DepositDef } from './defs';

/**
 * Map resource deposits. The world mapgen places them (ids below are stable —
 * world code uses `ctx.data.depositList()`); raw buildings with
 * `requiresDeposit` extract them (depositAmount decreases, depositQuality
 * feeds product quality).
 *
 * `amount` = typical units per tile. A 2×2 mine sitting on ~3 deposit tiles
 * produces ~150–250 units/month, so a site lasts ~8–12 years (then relocate to
 * fresh tiles of the field — the economy notifies the player on 'noDeposit').
 */
export const DEPOSITS: DepositDef[] = [
  { id: 'coal', name: 'Złoże węgla', icon: '⚫', product: 'coal', terrain: [Terrain.Hills, Terrain.Mountain, Terrain.Grass, Terrain.Forest], frequency: 1.2, amount: 11000, color: '#2b2b2b' },
  { id: 'iron', name: 'Złoże rudy żelaza', icon: '🪨', product: 'iron_ore', terrain: [Terrain.Hills, Terrain.Mountain], frequency: 1, amount: 9000, color: '#9a5a3c' },
  { id: 'clay', name: 'Złoże gliny', icon: '🟫', product: 'clay', terrain: [Terrain.Grass, Terrain.Swamp, Terrain.Beach, Terrain.Forest], frequency: 1, amount: 12000, color: '#b87a58' },
  { id: 'stone', name: 'Złoże kamienia', icon: '⛰️', product: 'stone', terrain: [Terrain.Hills, Terrain.Mountain, Terrain.Grass], frequency: 1, amount: 12000, color: '#a8a8a8' },
  { id: 'gold', name: 'Złoże złota', icon: '🥇', product: 'gold', terrain: [Terrain.Mountain, Terrain.Hills], frequency: 0.3, amount: 1400, color: '#e8c030' },
  { id: 'copper', name: 'Złoże rudy miedzi', icon: '🟠', product: 'copper_ore', terrain: [Terrain.Hills, Terrain.Mountain, Terrain.Desert], frequency: 0.8, amount: 9000, color: '#c07040' },
  { id: 'sand', name: 'Złoże piasku', icon: '🏖️', product: 'sand', terrain: [Terrain.Desert, Terrain.Beach, Terrain.Grass], frequency: 0.9, amount: 13000, color: '#e8d8a0' },
  { id: 'oil', name: 'Złoże ropy naftowej', icon: '🛢️', product: 'oil', terrain: [Terrain.Desert, Terrain.Grass, Terrain.Swamp, Terrain.Snow], frequency: 0.6, amount: 12000, color: '#101010' },
  { id: 'lithium', name: 'Złoże litu', icon: '🔘', product: 'lithium', terrain: [Terrain.Desert, Terrain.Mountain, Terrain.Snow], frequency: 0.4, amount: 5500, color: '#c0d8e0' },
];
