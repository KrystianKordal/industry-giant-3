/**
 * Test helpers for the logistics module (headless context with a private data
 * registry + test defs, flat map). Used only by *.test.ts files.
 */
import { createContext, type GameContext } from '../core/context';
import { addBuilding, createBuildingRecord } from '../core/entities';
import { startNewGame } from '../core/lifecycle';
import { NewGameStepOrder } from '../core/state';
import { Terrain, TileFlag, type Building, type GameState } from '../core/types';
import type { ModPack } from '../data/defs';
import { createRegistry } from '../data/registry';
import { init } from './index';

export function testPack(era: string): ModPack {
  const land = [Terrain.Grass, Terrain.Beach, Terrain.Forest, Terrain.Hills, Terrain.Desert, Terrain.Farmland];
  return {
    id: 'logistics-test',
    name: 'test',
    version: '1',
    products: [
      { id: 't_grain', name: 'Zboże T', icon: '🌾', category: 'agri', era, basePrice: 4, isRaw: true, weightClass: 'bulk' },
      { id: 't_flour', name: 'Mąka T', icon: '🥡', category: 'material', era, basePrice: 10, isRaw: false, weightClass: 'normal' },
      { id: 't_bread', name: 'Chleb T', icon: '🍞', category: 'food', era, basePrice: 22, isRaw: false, weightClass: 'light' },
    ],
    recipes: [
      { id: 't_grow', name: 'Uprawa', inputs: [], outputs: [{ product: 't_grain', qty: 10 }], days: 10, qualityModifier: 0 },
      { id: 't_mill', name: 'Mielenie', inputs: [{ product: 't_grain', qty: 10 }], outputs: [{ product: 't_flour', qty: 8 }], days: 5, qualityModifier: 0 },
    ],
    buildings: [
      { id: 't_farm', name: 'Farma T', icon: '🌾', category: 'raw', size: { w: 2, h: 2 }, cost: 1000, upkeep: 0, workers: 0, era, allowedTerrain: land, recipes: ['t_grow'], pollution: 0, capacity: 500, buildDays: 0 },
      { id: 't_mill', name: 'Młyn T', icon: '🏭', category: 'factory', size: { w: 2, h: 2 }, cost: 1000, upkeep: 0, workers: 0, era, allowedTerrain: land, recipes: ['t_mill'], pollution: 0, capacity: 200, buildDays: 0 },
      { id: 't_shop', name: 'Sklep T', icon: '🏪', category: 'shop', size: { w: 1, h: 1 }, cost: 500, upkeep: 0, workers: 0, era, allowedTerrain: land, recipes: [], sells: ['t_bread', 't_flour'], pollution: 0, capacity: 100, buildDays: 0 },
      { id: 't_wh', name: 'Magazyn T', icon: '📦', category: 'warehouse', size: { w: 2, h: 2 }, cost: 500, upkeep: 0, workers: 0, era, allowedTerrain: land, recipes: [], pollution: 0, capacity: 1000, buildDays: 0 },
      { id: 't_station', name: 'Stacja T', icon: '🚉', category: 'station', stationMode: 'rail', radius: 3, size: { w: 2, h: 1 }, cost: 500, upkeep: 0, workers: 0, era, allowedTerrain: land, recipes: [], pollution: 0, capacity: 1000, buildDays: 0 },
      { id: 't_harbor', name: 'Port T', icon: '⚓', category: 'station', stationMode: 'water', radius: 3, size: { w: 2, h: 2 }, cost: 500, upkeep: 0, workers: 0, era, allowedTerrain: land, recipes: [], pollution: 0, capacity: 1000, buildDays: 0 },
    ],
    vehicles: [
      { id: 't_cart', name: 'Wóz T', icon: '🐴', mode: 'road', capacity: 10, speed: 5, cost: 1000, upkeep: 30, era, lifespanYears: 15, emissions: 0 },
      { id: 't_train', name: 'Pociąg T', icon: '🚂', mode: 'rail', capacity: 20, speed: 8, cost: 5000, upkeep: 100, era, lifespanYears: 30, emissions: 0, wagons: { min: 1, max: 4, costPerWagon: 500 } },
      { id: 't_ship', name: 'Statek T', icon: '🚢', mode: 'water', capacity: 50, speed: 4, cost: 5000, upkeep: 100, era, lifespanYears: 30, emissions: 0 },
    ],
  };
}

export interface TestWorld {
  ctx: GameContext;
  state: GameState;
  player: number;
  /** Place a completed building of the player (bypassing economy rules). */
  place(typeId: string, x: number, y: number, owner?: number): Building;
  idx(x: number, y: number): number;
  /** Straight road/rail tiles from (x0,y0) to (x1,y1) (L-shaped, horizontal first). */
  line(x0: number, y0: number, x1: number, y1: number): number[];
}

export function createTestWorld(size = 48, opts: { water?: (x: number, y: number) => boolean } = {}): TestWorld {
  const data = createRegistry();
  const era = data.eraList()[0]!.id;
  data.mergeMod(testPack(era));
  const ctx = createContext({ headless: true, data });
  ctx.sim.throwOnError = true;
  init(ctx);
  ctx.newGame.register('mapgen', NewGameStepOrder.mapgen, (state) => {
    const { width: W, height: H } = state.map;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const water = opts.water?.(x, y) ?? false;
        state.map.terrain[i] = water ? Terrain.Water : Terrain.Grass;
        state.map.fertility[i] = 200;
        state.map.elevation[i] = water ? 0 : 20;
      }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (state.map.terrain[i] === Terrain.Water) continue;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && state.map.terrain[ny * W + nx] === Terrain.Water) state.map.flags[i]! |= TileFlag.Coast;
        }
      }
  });
  const state = startNewGame(ctx, { seed: 7, mapWidth: size, mapHeight: size, startYear: data.eraList()[0]!.startYear, startCash: 1_000_000, rivals: 0, cityCount: 0 });
  const player = state.playerCompanyId;
  const W = state.map.width;
  return {
    ctx,
    state,
    player,
    idx: (x, y) => y * W + x,
    place(typeId, x, y, owner = player) {
      const b = createBuildingRecord(state, data, typeId, owner, x, y, 0);
      b.constructionProgress = 1;
      b.status = 'ok';
      addBuilding(state, b);
      ctx.bus.emit('building:built', { buildingId: b.id });
      return b;
    },
    line(x0, y0, x1, y1) {
      const out: number[] = [];
      let x = x0;
      let y = y0;
      out.push(y * W + x);
      while (x !== x1) {
        x += Math.sign(x1 - x);
        out.push(y * W + x);
      }
      while (y !== y1) {
        y += Math.sign(y1 - y);
        out.push(y * W + x);
      }
      return out;
    },
  };
}
