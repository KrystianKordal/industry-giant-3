/**
 * PLACEHOLDER map generator (registered as new-game step 'mapgen').
 * The world agent replaces it by registering its own step named 'mapgen'.
 * Produces: terrain, elevation, fertility, forest, coast flags, deposits.
 */
import type { GameContext } from './context';
import { createRng, hashSeed, rng } from './rng';
import { Terrain, TileFlag, type GameState, type NewGameOptions } from './types';
import { DIR4, clamp } from './util';

/** Seeded 2D value noise with fractal octaves; returns ~0..1. */
export function makeNoise2D(seed: number): (x: number, y: number) => number {
  const h = (ix: number, iy: number): number => {
    let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const base = (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const a = h(x0, y0);
    const b = h(x0 + 1, y0);
    const c = h(x0, y0 + 1);
    const d = h(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y) => {
    let v = 0;
    let amp = 0.5;
    let f = 1;
    let norm = 0;
    for (let o = 0; o < 5; o++) {
      v += base(x * f, y * f) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return v / norm;
  };
}

export function placeholderMapgen(state: GameState, options: NewGameOptions, ctx: GameContext): void {
  const map = state.map;
  const { width: W, height: H } = map;
  const N = W * H;
  const elevN = makeNoise2D(hashSeed(options.seed, 'elev'));
  const moistN = makeNoise2D(hashSeed(options.seed, 'moist'));
  const scale = 1 / 28;

  const elev = new Float32Array(N);
  const moist = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let e = elevN(x * scale, y * scale);
      if (options.mapPreset === 'continent' || options.mapPreset === 'islands') {
        const dx = (x / W) * 2 - 1;
        const dy = (y / H) * 2 - 1;
        const falloff = Math.max(Math.abs(dx), Math.abs(dy));
        e -= Math.pow(falloff, 3) * (options.mapPreset === 'islands' ? 0.5 : 0.35);
      }
      elev[i] = e;
      moist[i] = moistN(x * scale * 1.3 + 100, y * scale * 1.3);
    }
  }
  // sea level = water quantile
  const sorted = Float32Array.from(elev).sort();
  const sea = sorted[Math.floor(clamp(options.waterLevel, 0, 0.9) * (N - 1))]!;
  const top = sorted[N - 1]!;
  const range = Math.max(1e-6, top - sea);
  map.seaLevel = 0;

  for (let i = 0; i < N; i++) {
    const e = elev[i]!;
    const m = moist[i]!;
    let t: number;
    if (e < sea) {
      t = e < sea - 0.06 ? Terrain.DeepWater : Terrain.Water;
      map.elevation[i] = 0;
    } else {
      const h = Math.pow((e - sea) / range, 1.6); // 0..1 above sea, flattened lowlands
      map.elevation[i] = Math.round(h * 255);
      if (h < 0.04) t = Terrain.Beach;
      else if (h > 0.85) t = Terrain.Snow;
      else if (h > 0.6) t = Terrain.Mountain;
      else if (h > 0.4) t = Terrain.Hills;
      else if (m > 0.62) t = h < 0.12 && m > 0.7 ? Terrain.Swamp : Terrain.Forest;
      else if (m < 0.33) t = Terrain.Desert;
      else t = Terrain.Grass;
    }
    map.terrain[i] = t;
    map.fertility[i] =
      t === Terrain.Grass ? Math.round(120 + m * 135) : t === Terrain.Forest ? 90 : t === Terrain.Swamp ? 60 : t === Terrain.Hills ? 60 : t === Terrain.Desert ? 15 : 0;
    map.forest[i] = t === Terrain.Forest ? Math.round(140 + m * 115) : 0;
  }

  // coast flags
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (map.terrain[i]! <= Terrain.Water) continue;
      for (const [dx, dy] of DIR4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && map.terrain[ny * W + nx]! <= Terrain.Water) {
          map.flags[i]! |= TileFlag.Coast;
          break;
        }
      }
    }

  // deposits
  const r = rng(createRng(hashSeed(options.seed, 'deposits')));
  const defs = ctx.data.depositList();
  map.depositTypes = ['', ...defs.map((d) => d.id)];
  defs.forEach((def, k) => {
    const clusters = Math.max(1, Math.round(((N / 900) * def.frequency * options.resourceAbundance) / Math.max(1, defs.length / 2)));
    for (let c = 0; c < clusters; c++) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const cx = r.int(0, W - 1);
        const cy = r.int(0, H - 1);
        if (!def.terrain.includes(map.terrain[cy * W + cx] as never)) continue;
        const rad = r.int(1, 3);
        const quality = r.range(0.3, 1);
        for (let y = cy - rad; y <= cy + rad; y++)
          for (let x = cx - rad; x <= cx + rad; x++) {
            if (x < 0 || y < 0 || x >= W || y >= H || (x - cx) ** 2 + (y - cy) ** 2 > rad * rad + 0.5) continue;
            const i = y * W + x;
            if (map.terrain[i]! <= Terrain.Water || map.deposit[i]) continue;
            map.deposit[i] = k + 1;
            map.depositAmount[i] = def.amount * r.range(0.5, 1.5);
            map.depositQuality[i] = Math.round(clamp(quality + r.range(-0.1, 0.1), 0, 1) * 255);
          }
        break;
      }
    }
  });
}
