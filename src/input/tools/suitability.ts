/**
 * Build-site suitability map for the build tool: for every CURSOR tile of the
 * map (the build tool centres the footprint on the cursor, see anchorFor) says
 * whether the selected building could be placed there.
 *
 * Mirrors core/entities checkPlacement + the economy wrapper (terrain,
 * occupancy, roads/rails, Blocked, deposit under the footprint, average
 * fertility, water access, city permits, one-per-company, unlocks) — everything
 * except cash, so the player sees where to aim before saving up.
 *
 * Cost: O(map) with summed-area tables (≈ 2–4 ms for 256×256). The build tool
 * computes it once per (building type, rotation) and again only after
 * map / network / building / permit changes (throttled) — never per frame.
 */
import type { GameContext } from '../../core/context';
import { footprintSize } from '../../core/entities';
import { TileFlag, type CompanyId } from '../../core/types';

/** mask values */
export const SUIT_NONE = 0;
export const SUIT_OK = 1;
/** valid and above-average site (farms: rich soil, mines: deposit under most of the footprint) */
export const SUIT_GOOD = 2;

export interface Suitability {
  typeId: string;
  rotation: number;
  width: number;
  height: number;
  /** Per cursor tile (idx = y * width + x): SUIT_NONE / SUIT_OK / SUIT_GOOD. */
  mask: Uint8Array;
  /** Number of valid cursor tiles. */
  count: number;
  /** Why nothing is valid (locked building, one-per-company…), else null. */
  blocked: string | null;
}

/** Summed-area table (W+1)×(H+1) of a per-tile value. */
function sat(W: number, H: number, val: (i: number) => number): Int32Array {
  const S = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += val(y * W + x);
      S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1]! + row;
    }
  }
  return S;
}

/** Sum over [x0,x1) × [y0,y1) (clamped to the map). */
function rectSum(S: Int32Array, W: number, H: number, x0: number, y0: number, x1: number, y1: number): number {
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(W, x1);
  y1 = Math.min(H, y1);
  if (x1 <= x0 || y1 <= y0) return 0;
  const R = W + 1;
  return S[y1 * R + x1]! - S[y0 * R + x1]! - S[y1 * R + x0]! + S[y0 * R + x0]!;
}

export function computeSuitability(ctx: GameContext, companyId: CompanyId, typeId: string, rotation: 0 | 1 | 2 | 3): Suitability {
  const state = ctx.state;
  const map = state.map;
  const W = map.width;
  const H = map.height;
  const mask = new Uint8Array(W * H);
  const res: Suitability = { typeId, rotation, width: W, height: H, mask, count: 0, blocked: null };
  const def = ctx.data.buildings[typeId];
  if (!def) {
    res.blocked = 'Nieznany typ budynku';
    return res;
  }
  let unlocked = true;
  try {
    unlocked = !companyId || ctx.services.economy.isUnlocked(companyId, 'building', typeId);
  } catch {
    unlocked = true;
  }
  if (!unlocked) {
    res.blocked = 'Budynek jeszcze niedostępny';
    return res;
  }
  if ((def.category === 'hq' || def.unique) && companyId && Object.values(state.buildings).some((b) => b.owner === companyId && b.typeId === typeId)) {
    res.blocked = 'Masz już taki budynek';
    return res;
  }

  const { w, h } = footprintSize(def, rotation);
  const allowed = new Uint8Array(256);
  for (const t of def.allowedTerrain) allowed[t] = 1;
  const { terrain, building, flags, fertility, deposit, depositTypes, depositAmount } = map;
  const { road, rail } = state.network;
  const bad = sat(W, H, (i) => (!allowed[terrain[i]!] || building[i] || road[i] || rail[i] || flags[i]! & TileFlag.Blocked ? 1 : 0));
  const needFert = def.minFertility ?? 0;
  const fert = needFert ? sat(W, H, (i) => fertility[i]!) : null;
  const dep = def.requiresDeposit ? sat(W, H, (i) => (depositTypes[deposit[i]!] === def.requiresDeposit && depositAmount[i]! > 0 ? 1 : 0)) : null;
  const water = def.requiresWater ? sat(W, H, (i) => (ctx.data.terrain[terrain[i]!]?.isWater ? 1 : 0)) : null;
  const area = w * h;
  // Richer soil than required by ~⅓ of the headroom (or ≥ 65% fertility) counts as "good".
  const goodFert = needFert ? Math.min(255 * 0.65, needFert + (255 - needFert) * 0.33) : 0;

  // anchor-level validity
  const ok = new Uint8Array(W * H);
  for (let ay = 0; ay + h <= H; ay++)
    for (let ax = 0; ax + w <= W; ax++) {
      if (rectSum(bad, W, H, ax, ay, ax + w, ay + h)) continue;
      let v: number = SUIT_OK;
      if (fert) {
        const avg = rectSum(fert, W, H, ax, ay, ax + w, ay + h) / area;
        if (avg < needFert) continue;
        if (avg >= goodFert) v = SUIT_GOOD;
      }
      if (dep) {
        const n = rectSum(dep, W, H, ax, ay, ax + w, ay + h);
        if (!n) continue;
        if (n * 2 >= area) v = SUIT_GOOD;
      }
      if (water && !rectSum(water, W, H, ax - 1, ay - 1, ax + w + 1, ay + h + 1)) continue;
      ok[ay * W + ax] = v;
    }

  // city permits (economy checkPlacement: footprint centre within city radius + 2)
  if (companyId) {
    for (const city of Object.values(state.cities)) {
      const permit = city.permits[companyId] ?? 'granted';
      if (!(permit === 'denied' || (permit === 'restricted' && def.pollution > 2))) continue;
      const r = city.radius + 2;
      for (let ay = Math.max(0, Math.floor(city.y - r - h)); ay <= Math.min(H - 1, Math.ceil(city.y + r)); ay++)
        for (let ax = Math.max(0, Math.floor(city.x - r - w)); ax <= Math.min(W - 1, Math.ceil(city.x + r)); ax++)
          if (Math.hypot(ax + w / 2 - city.x, ay + h / 2 - city.y) <= r) ok[ay * W + ax] = SUIT_NONE;
    }
  }

  // anchor → cursor (same offset as build.ts anchorFor)
  const ox = Math.floor((w - 1) / 2);
  const oy = Math.floor((h - 1) / 2);
  let count = 0;
  for (let ay = 0; ay < H; ay++)
    for (let ax = 0; ax < W; ax++) {
      const v = ok[ay * W + ax]!;
      if (!v) continue;
      const cx = ax + ox;
      const cy = ay + oy;
      if (cx >= W || cy >= H) continue;
      mask[cy * W + cx] = v;
      count++;
    }
  res.count = count;
  return res;
}

/**
 * Nearest valid cursor tile to (x, y) (prefers SUIT_GOOD within 1.5× the
 * distance of the nearest valid one). Linear scan of the mask — cheap enough
 * for an on-demand call; callers cache per hover tile.
 */
export function nearestSuitable(s: Suitability, x: number, y: number): { x: number; y: number; dist: number } | null {
  let best: { x: number; y: number; d: number } | null = null;
  let bestGood: { x: number; y: number; d: number } | null = null;
  const W = s.width;
  for (let i = 0; i < s.mask.length; i++) {
    const v = s.mask[i]!;
    if (!v) continue;
    const tx = i % W;
    const ty = (i - tx) / W;
    const d = (tx - x) * (tx - x) + (ty - y) * (ty - y);
    if (!best || d < best.d) best = { x: tx, y: ty, d };
    if (v === SUIT_GOOD && (!bestGood || d < bestGood.d)) bestGood = { x: tx, y: ty, d };
  }
  if (!best) return null;
  const pick = bestGood && Math.sqrt(bestGood.d) <= Math.sqrt(best.d) * 1.5 + 2 ? bestGood : best;
  return { x: pick.x, y: pick.y, dist: Math.sqrt(pick.d) };
}
