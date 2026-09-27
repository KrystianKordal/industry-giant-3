/**
 * Seeded deterministic RNG (mulberry32). The state lives in plain data
 * (`RngState`), so it is saved with the game and simulation stays reproducible.
 *
 *   const r = rng(state.rng);   // wrapper mutating state.rng
 *   r.int(1, 6); r.chance(0.1); r.pick(arr);
 *
 * Use `state.rng` for gameplay randomness. For generation passes that must not
 * disturb gameplay (mapgen, names), create a separate stream:
 *   const r = rng(createRng(hashSeed(seed, 'mapgen')));
 * Never use Math.random() inside simulation systems.
 */
import type { RngState } from './types';

export function createRng(seed: number): RngState {
  const s = seed >>> 0;
  return { seed: s, s };
}

/** Next float in [0, 1). Mutates `r`. */
export function nextFloat(r: RngState): number {
  let t = (r.s = (r.s + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Hash a seed with any number of string/number salts into a uint32 (FNV-1a + mix). */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  const str = parts.join('|');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Random uint32 seed for new games (the only place Math.random is allowed). */
export const randomSeed = (): number => (Math.random() * 4294967296) >>> 0;

/** Convenience wrapper around an RngState (the wrapper itself is not stored). */
export class Rng {
  constructor(public readonly state: RngState) {}
  /** Float in [0,1). */
  next(): number {
    return nextFloat(this.state);
  }
  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * nextFloat(this.state);
  }
  /** Integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(nextFloat(this.state) * (max - min + 1));
  }
  /** true with probability p. */
  chance(p: number): boolean {
    return nextFloat(this.state) < p;
  }
  /** Random element (undefined for empty array). */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(nextFloat(this.state) * arr.length)]!;
  }
  /** Weighted pick; weights >= 0. */
  weighted<T>(items: readonly T[], weight: (t: T) => number): T | undefined {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    if (total <= 0) return undefined;
    let r = nextFloat(this.state) * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r < 0) return it;
    }
    return items[items.length - 1];
  }
  /** In-place Fisher–Yates shuffle; returns the array. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(nextFloat(this.state) * (i + 1));
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    return arr;
  }
  /** Approximately normal (mean 0, sd 1) via Box–Muller. */
  normal(): number {
    const u = 1 - nextFloat(this.state);
    const v = nextFloat(this.state);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

/** Wrap an RngState (e.g. `rng(state.rng).int(0, 9)`). */
export const rng = (state: RngState): Rng => new Rng(state);
