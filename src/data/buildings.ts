import { Terrain } from '../core/types';
import type { BuildingDef } from './defs';
import { LAND_BUILDABLE } from './terrain';

/** PLACEHOLDER buildings (farm → mill → bakery → shop, + warehouse, depot). The data agent fills the full list. */
export const BUILDINGS: BuildingDef[] = [
  { id: 'farm_grain', name: 'Farma zboża', icon: '🌾', category: 'raw', size: { w: 3, h: 3 }, cost: 8000, upkeep: 150, workers: 8, era: 'industrial', allowedTerrain: [Terrain.Grass, Terrain.Farmland], minFertility: 80, recipes: ['grow_grain'], pollution: 1, capacity: 200, buildDays: 10, color: '#c9b04a', description: 'Uprawia zboże. Wydajność zależy od żyzności gleby i pogody.' },
  { id: 'coal_mine', name: 'Kopalnia węgla', icon: '⛏️', category: 'raw', size: { w: 2, h: 2 }, cost: 12000, upkeep: 250, workers: 15, era: 'industrial', allowedTerrain: [Terrain.Grass, Terrain.Hills, Terrain.Mountain], requiresDeposit: 'coal', recipes: ['mine_coal'], pollution: 6, capacity: 200, buildDays: 15, color: '#444444' },
  { id: 'mill', name: 'Młyn', icon: '🏭', category: 'factory', size: { w: 2, h: 2 }, cost: 10000, upkeep: 200, workers: 10, era: 'industrial', allowedTerrain: LAND_BUILDABLE, recipes: ['mill_flour'], pollution: 2, capacity: 150, buildDays: 12, color: '#b9a37a' },
  { id: 'bakery', name: 'Piekarnia', icon: '🥖', category: 'factory', size: { w: 2, h: 2 }, cost: 9000, upkeep: 180, workers: 8, era: 'industrial', allowedTerrain: LAND_BUILDABLE, recipes: ['bake_bread', 'bake_bread_cheap'], pollution: 1, capacity: 120, buildDays: 10, color: '#d08a4a' },
  { id: 'shop_food', name: 'Sklep spożywczy', icon: '🏪', category: 'shop', size: { w: 1, h: 1 }, cost: 5000, upkeep: 120, workers: 3, era: 'industrial', allowedTerrain: [...LAND_BUILDABLE, Terrain.Urban], recipes: [], sells: ['bread', 'flour'], radius: 8, pollution: 0, capacity: 100, buildDays: 5, color: '#4aa0d0' },
  { id: 'warehouse', name: 'Magazyn', icon: '📦', category: 'warehouse', size: { w: 2, h: 2 }, cost: 7000, upkeep: 100, workers: 4, era: 'industrial', allowedTerrain: LAND_BUILDABLE, recipes: [], pollution: 0, capacity: 500, buildDays: 8, color: '#8a7a6a' },
  { id: 'truck_depot', name: 'Zajezdnia', icon: '🅿️', category: 'station', size: { w: 1, h: 1 }, cost: 3000, upkeep: 60, workers: 2, era: 'industrial', allowedTerrain: LAND_BUILDABLE, recipes: [], stationMode: 'road', pollution: 0, capacity: 0, buildDays: 4, color: '#607080' },
];
