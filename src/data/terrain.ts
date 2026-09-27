import { Terrain } from '../core/types';
import type { TerrainDef } from './defs';

/** Terrain metadata indexed by TerrainId (TERRAIN_DEFS[terrainId]). */
export const TERRAIN_DEFS: TerrainDef[] = [
  { id: Terrain.DeepWater, name: 'Głęboka woda', color: '#1d4e7a', buildable: false, isWater: true, buildCost: 1, networkCost: Infinity },
  { id: Terrain.Water, name: 'Płytka woda', color: '#2f6f9f', buildable: false, isWater: true, buildCost: 1, networkCost: Infinity },
  { id: Terrain.Beach, name: 'Plaża', color: '#d8c98f', buildable: true, isWater: false, buildCost: 1.1, networkCost: 1.1 },
  { id: Terrain.Grass, name: 'Równina', color: '#6fa35a', buildable: true, isWater: false, buildCost: 1, networkCost: 1 },
  { id: Terrain.Forest, name: 'Las', color: '#3f7a43', buildable: true, isWater: false, buildCost: 1.3, networkCost: 1.4 },
  { id: Terrain.Hills, name: 'Wzgórza', color: '#8f9a5e', buildable: true, isWater: false, buildCost: 1.5, networkCost: 1.8 },
  { id: Terrain.Mountain, name: 'Góry', color: '#8a8580', buildable: true, isWater: false, buildCost: 2.5, networkCost: 4 },
  { id: Terrain.Desert, name: 'Pustynia', color: '#d6b46a', buildable: true, isWater: false, buildCost: 1.2, networkCost: 1.2 },
  { id: Terrain.Snow, name: 'Tundra', color: '#e6eef0', buildable: true, isWater: false, buildCost: 1.6, networkCost: 1.6 },
  { id: Terrain.Swamp, name: 'Bagno', color: '#5b6e4a', buildable: true, isWater: false, buildCost: 2, networkCost: 2.2 },
  { id: Terrain.Farmland, name: 'Pole uprawne', color: '#a8a04e', buildable: true, isWater: false, buildCost: 1, networkCost: 1 },
  { id: Terrain.Urban, name: 'Teren miejski', color: '#8c8c8c', buildable: false, isWater: false, buildCost: 3, networkCost: 1 },
];

/** Land terrains where ordinary buildings are allowed. */
export const LAND_BUILDABLE = [Terrain.Beach, Terrain.Grass, Terrain.Forest, Terrain.Hills, Terrain.Desert, Terrain.Snow, Terrain.Farmland];
