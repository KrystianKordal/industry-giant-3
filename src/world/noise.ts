/**
 * Seeded 2D simplex noise (Gustavson's algorithm) + fractal helpers.
 * No dependencies, no allocations per sample.
 *
 *   const n = createSimplex2D(seed);
 *   n(x, y)            // ~[-1, 1]
 *   fbm(n, x, y, 5)    // ~[-1, 1], fractal sum
 *   ridged(n, x, y, 4) // [0, 1], sharp ridges (mountain ranges)
 */
import { createRng, nextFloat } from '../core/rng';

export type Noise2D = (x: number, y: number) => number;

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
/** 12 gradient directions (x,y pairs). */
const GRAD = new Float64Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1, 0.7071, 0.7071, -0.7071, 0.7071, 0.7071, -0.7071, -0.7071, -0.7071]);

/** Create a seeded simplex noise function returning roughly [-1, 1]. */
export function createSimplex2D(seed: number): Noise2D {
  const r = createRng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(nextFloat(r) * (i + 1));
    const t = p[i]!;
    p[i] = p[j]!;
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255]!;
    permMod12[i] = perm[i]! % 12;
  }

  return (xin: number, yin: number): number => {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = permMod12[ii + perm[jj]!]! * 2;
      t0 *= t0;
      n += t0 * t0 * (GRAD[g]! * x0 + GRAD[g + 1]! * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = permMod12[ii + i1 + perm[jj + j1]!]! * 2;
      t1 *= t1;
      n += t1 * t1 * (GRAD[g]! * x1 + GRAD[g + 1]! * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = permMod12[ii + 1 + perm[jj + 1]!]! * 2;
      t2 *= t2;
      n += t2 * t2 * (GRAD[g]! * x2 + GRAD[g + 1]! * y2);
    }
    return 70 * n;
  };
}

/** Fractal Brownian motion: sum of octaves, normalized to ~[-1, 1]. */
export function fbm(noise: Noise2D, x: number, y: number, octaves = 5, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal noise in [0, 1] (1 = ridge crest). */
export function ridged(noise: Noise2D, x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const v = 1 - Math.abs(noise(x * freq, y * freq));
    sum += v * v * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Deterministic hash of integers → [0, 1). Handy for per-tile / per-entity jitter. */
export function hash01(a: number, b = 0, c = 0): number {
  let n = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}

/** Hash a string to uint32 (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
