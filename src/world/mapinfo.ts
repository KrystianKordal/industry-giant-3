/**
 * Map analysis helpers (pure, runtime-only results — never stored in state):
 * landmasses, BFS distance fields, water classification.
 */
import type { DataRegistry } from '../data/registry';
import { Terrain, TileFlag, type MapState } from '../core/types';

export const isWaterTerrain = (t: number): boolean => t === Terrain.DeepWater || t === Terrain.Water;

/** Multi-source 4-neighbour BFS distance (in tiles, capped at 255). `passable` limits expansion. */
export function bfsDistance(
  W: number,
  H: number,
  isSource: (i: number) => boolean,
  passable: (i: number) => boolean = () => true,
  cap = 255,
): Uint8Array {
  const N = W * H;
  const d = new Uint8Array(N).fill(255);
  const q = new Int32Array(N);
  let qh = 0;
  let qt = 0;
  for (let i = 0; i < N; i++)
    if (isSource(i)) {
      d[i] = 0;
      q[qt++] = i;
    }
  while (qh < qt) {
    const i = q[qh++]!;
    const nd = d[i]! + 1;
    if (nd > cap) continue;
    const x = i % W;
    const y = (i / W) | 0;
    for (let k = 0; k < 4; k++) {
      let n: number;
      if (k === 0) {
        if (x === 0) continue;
        n = i - 1;
      } else if (k === 1) {
        if (x === W - 1) continue;
        n = i + 1;
      } else if (k === 2) {
        if (y === 0) continue;
        n = i - W;
      } else {
        if (y === H - 1) continue;
        n = i + W;
      }
      if (d[n]! <= nd || !passable(n)) continue;
      d[n] = nd;
      q[qt++] = n;
    }
  }
  return d;
}

export interface Landmasses {
  /** Landmass id per tile (0 = water). */
  id: Int32Array;
  /** sizes[id] = tile count (sizes[0] = 0). */
  sizes: number[];
}

/** Label 4-connected land regions. */
export function computeLandmasses(map: MapState): Landmasses {
  const W = map.width;
  const H = map.height;
  const N = W * H;
  const id = new Int32Array(N);
  const sizes: number[] = [0];
  const q = new Int32Array(N);
  let next = 1;
  for (let s = 0; s < N; s++) {
    if (id[s] || isWaterTerrain(map.terrain[s]!)) continue;
    const lid = next++;
    let qh = 0;
    let qt = 0;
    q[qt++] = s;
    id[s] = lid;
    while (qh < qt) {
      const i = q[qh++]!;
      const x = i % W;
      const y = (i / W) | 0;
      for (let k = 0; k < 4; k++) {
        const n = k === 0 ? (x > 0 ? i - 1 : -1) : k === 1 ? (x < W - 1 ? i + 1 : -1) : k === 2 ? (y > 0 ? i - W : -1) : y < H - 1 ? i + W : -1;
        if (n < 0 || id[n] || isWaterTerrain(map.terrain[n]!)) continue;
        id[n] = lid;
        q[qt++] = n;
      }
    }
    sizes.push(qt);
  }
  return { id, sizes };
}

/** Ocean mask: water tiles 4-connected to the map border. */
export function computeOcean(map: MapState): Uint8Array {
  const W = map.width;
  const H = map.height;
  const N = W * H;
  const ocean = new Uint8Array(N);
  const q = new Int32Array(N);
  let qt = 0;
  const push = (i: number): void => {
    if (ocean[i] || !isWaterTerrain(map.terrain[i]!)) return;
    ocean[i] = 1;
    q[qt++] = i;
  };
  for (let x = 0; x < W; x++) {
    push(x);
    push((H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    push(y * W);
    push(y * W + W - 1);
  }
  let qh = 0;
  while (qh < qt) {
    const i = q[qh++]!;
    const x = i % W;
    const y = (i / W) | 0;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (y > 0) push(i - W);
    if (y < H - 1) push(i + W);
  }
  return ocean;
}

/** Distance to the nearest river tile. */
export const riverDistance = (map: MapState, cap = 32): Uint8Array =>
  bfsDistance(map.width, map.height, (i) => (map.flags[i]! & TileFlag.River) !== 0, () => true, cap);

/** Can ordinary things (houses, buildings) stand on this terrain? */
export const terrainBuildable = (data: DataRegistry, t: number): boolean => !!data.terrain[t]?.buildable;
