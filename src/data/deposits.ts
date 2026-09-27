import { Terrain } from '../core/types';
import type { DepositDef } from './defs';

/** Map resource deposits (mapgen places them, raw buildings extract them). PLACEHOLDER — data agent extends. */
export const DEPOSITS: DepositDef[] = [
  { id: 'coal', name: 'Złoże węgla', icon: '⚫', product: 'coal', terrain: [Terrain.Hills, Terrain.Mountain, Terrain.Grass], frequency: 1, amount: 5000, color: '#2b2b2b' },
  { id: 'iron', name: 'Złoże rudy żelaza', icon: '🟤', product: 'iron_ore', terrain: [Terrain.Hills, Terrain.Mountain], frequency: 0.8, amount: 4000, color: '#9a5a3c' },
];
