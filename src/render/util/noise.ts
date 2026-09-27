/**
 * Deterministic hashing & a precomputed tileable fractal value-noise texture
 * for procedural terrain detail. Render-only (not used by the simulation).
 */

/** 32-bit integer hash of (x, y, seed). */
export function hashInt(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash → float 0..1. */
export const hash01 = (x: number, y: number, seed = 0): number => hashInt(x, y, seed) / 4294967296;

export const NOISE_SIZE = 256;
const NM = NOISE_SIZE - 1;

/** Tileable fBm value noise, values ~0..1, NOISE_SIZE² entries. */
export const NOISE: Float32Array = (() => {
  const N = NOISE_SIZE;
  const out = new Float32Array(N * N);
  let amp = 0.5;
  let norm = 0;
  for (let oct = 0, period = 32; oct < 5; oct++, period >>= 1) {
    const cells = N / period;
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = hash01(i % cells, (i / cells) | 0, 917 + oct * 31);
    for (let y = 0; y < N; y++) {
      const gy = y / period;
      const iy = Math.floor(gy);
      let fy = gy - iy;
      fy = fy * fy * (3 - 2 * fy);
      const y0 = (iy % cells) * cells;
      const y1 = ((iy + 1) % cells) * cells;
      for (let x = 0; x < N; x++) {
        const gx = x / period;
        const ix = Math.floor(gx);
        let fx = gx - ix;
        fx = fx * fx * (3 - 2 * fx);
        const x0 = ix % cells;
        const x1 = (ix + 1) % cells;
        const a = lattice[y0 + x0]!;
        const b = lattice[y0 + x1]!;
        const c = lattice[y1 + x0]!;
        const d = lattice[y1 + x1]!;
        out[y * N + x] += (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy) * amp;
      }
    }
    norm += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i]! / norm;
  // stretch contrast to roughly 0..1
  let lo = 1, hi = 0;
  for (let i = 0; i < out.length; i++) {
    const v = out[i]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const k = 1 / Math.max(1e-6, hi - lo);
  for (let i = 0; i < out.length; i++) out[i] = (out[i]! - lo) * k;
  return out;
})();

/** Sample noise with bilinear filtering; (x, y) in texels (wraps). */
export function noiseAt(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const x0 = ix & NM;
  const y0 = (iy & NM) * NOISE_SIZE;
  const x1 = (ix + 1) & NM;
  const y1 = ((iy + 1) & NM) * NOISE_SIZE;
  const a = NOISE[y0 + x0]!;
  const b = NOISE[y0 + x1]!;
  const c = NOISE[y1 + x0]!;
  const d = NOISE[y1 + x1]!;
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Nearest-texel noise lookup (cheaper). */
export const noiseFast = (x: number, y: number): number => NOISE[((y | 0) & NM) * NOISE_SIZE + ((x | 0) & NM)]!;
