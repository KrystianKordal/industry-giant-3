/**
 * Site search for AI buildings. Placement rules are NOT duplicated here — every
 * candidate is validated with ctx.services.economy.checkPlacement. We only add
 * AI preferences: keep a 1-tile corridor around buildings (room for roads),
 * prefer good deposits / fertile soil, stay close to the target.
 */
import type { GameContext } from '../core/context';
import { footprintSize } from '../core/entities';
import type { CompanyId, GameState, TilePos, TileRect } from '../core/types';

export interface Site {
  x: number;
  y: number;
  rotation: 0 | 1 | 2 | 3;
}

export interface SiteOptions {
  minR?: number;
  maxR: number;
  /** Keep a free ring around the footprint (default true). */
  spacing?: boolean;
  /** How many valid candidates to compare before picking the best (default 4). */
  candidates?: number;
  /** Hard cap on placement checks (time budget). */
  maxChecks?: number;
  /** Rects (incl. 1-tile margin) already reserved by the caller. */
  avoid?: TileRect[];
}

/** Tiles of the ring at Chebyshev distance r around (cx, cy). */
function* ring(cx: number, cy: number, r: number): Generator<TilePos> {
  if (r === 0) {
    yield { x: cx, y: cy };
    return;
  }
  for (let dx = -r; dx <= r; dx++) {
    yield { x: cx + dx, y: cy - r };
    yield { x: cx + dx, y: cy + r };
  }
  for (let dy = -r + 1; dy <= r - 1; dy++) {
    yield { x: cx - r, y: cy + dy };
    yield { x: cx + r, y: cy + dy };
  }
}

function hasCorridor(state: GameState, x: number, y: number, w: number, h: number): boolean {
  const m = state.map;
  for (let ty = y - 1; ty <= y + h; ty++) {
    for (let tx = x - 1; tx <= x + w; tx++) {
      if (tx >= x && tx < x + w && ty >= y && ty < y + h) continue;
      if (tx < 0 || ty < 0 || tx >= m.width || ty >= m.height) continue;
      if (m.building[ty * m.width + tx]) return false;
    }
  }
  return true;
}

/** Quality score of a site for a building type (higher = better). */
function siteQuality(state: GameState, ctx: GameContext, typeId: string, x: number, y: number, w: number, h: number): number {
  const def = ctx.data.buildings[typeId];
  if (!def) return 0;
  const m = state.map;
  let q = 0;
  let n = 0;
  for (let ty = y; ty < y + h; ty++)
    for (let tx = x; tx < x + w; tx++) {
      const i = ty * m.width + tx;
      if (def.requiresDeposit) q += m.depositQuality[i]! / 255;
      else if (def.minFertility) q += m.fertility[i]! / 255;
      else q += 0.5;
      n++;
    }
  return n ? q / n : 0;
}

/**
 * Find a valid site for `typeId` around (cx, cy). Returns null when nothing
 * valid was found within the radius / check budget.
 */
export function findSite(ctx: GameContext, companyId: CompanyId, typeId: string, cx: number, cy: number, o: SiteOptions): Site | null {
  const state = ctx.state;
  const def = ctx.data.buildings[typeId];
  if (!def) return null;
  const { w, h } = footprintSize(def, 0);
  const minR = o.minR ?? 0;
  const want = o.candidates ?? 4;
  const maxChecks = o.maxChecks ?? 4000;
  const spacing = o.spacing ?? true;
  let checks = 0;
  const found: { site: Site; score: number }[] = [];
  const m = state.map;
  for (let r = minR; r <= o.maxR; r++) {
    for (const t of ring(Math.round(cx), Math.round(cy), r)) {
      const x = t.x - Math.floor(w / 2);
      const y = t.y - Math.floor(h / 2);
      if (x < 0 || y < 0 || x + w > m.width || y + h > m.height) continue;
      if (m.building[y * m.width + x]) continue; // cheap pre-filter
      if (++checks > maxChecks) return pick(found);
      if (o.avoid && o.avoid.some((a) => x < a.x + a.w + 1 && x + w + 1 > a.x && y < a.y + a.h + 1 && y + h + 1 > a.y)) continue;
      if (spacing && !hasCorridor(state, x, y, w, h)) continue;
      let ok = false;
      try {
        ok = ctx.services.economy.checkPlacement(companyId, typeId, x, y, 0).ok;
      } catch {
        ok = false;
      }
      if (!ok) continue;
      const q = siteQuality(state, ctx, typeId, x, y, w, h);
      found.push({ site: { x, y, rotation: 0 }, score: q * 10 - r * 0.25 });
      if (found.length >= want) return pick(found);
    }
    // Once something is found, don't wander much further.
    if (found.length && r > minR + 3) return pick(found);
  }
  return pick(found);
}

function pick(found: { site: Site; score: number }[]): Site | null {
  if (!found.length) return null;
  found.sort((a, b) => b.score - a.score);
  return found[0]!.site;
}

// ---------------------------------------------------------------- resource index (runtime cache)
let resKey = '';
let resIndex = new Map<string, TilePos[]>();

/** Tiles (sampled) with a given deposit type — cached per game & quarter. */
export function depositTiles(state: GameState, depositType: string): TilePos[] {
  const key = `${state.meta.id}:${Math.floor(state.time.totalDays / 90)}`;
  if (key !== resKey) {
    resKey = key;
    resIndex = new Map();
    const m = state.map;
    for (let i = 0; i < m.deposit.length; i++) {
      const d = m.deposit[i]!;
      if (!d || m.depositAmount[i]! <= 0) continue;
      const id = m.depositTypes[d] ?? '';
      let arr = resIndex.get(id);
      if (!arr) resIndex.set(id, (arr = []));
      arr.push({ x: i % m.width, y: Math.floor(i / m.width) });
    }
  }
  return resIndex.get(depositType) ?? [];
}

/** Nearest tile to (x,y) from a list (null if empty). Skips tiles occupied by buildings. */
export function nearestTile(state: GameState, list: TilePos[], x: number, y: number): TilePos | null {
  let best: TilePos | null = null;
  let bd = Infinity;
  const m = state.map;
  for (const t of list) {
    if (m.building[t.y * m.width + t.x]) continue;
    const d = (t.x - x) ** 2 + (t.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}

/** Best anchor for a raw building near (x,y): nearest deposit, else the position itself. */
export function rawAnchor(ctx: GameContext, typeId: string, x: number, y: number): TilePos {
  const def = ctx.data.buildings[typeId];
  if (def?.requiresDeposit) {
    const t = nearestTile(ctx.state, depositTiles(ctx.state, def.requiresDeposit), x, y);
    if (t) return t;
  }
  return { x, y };
}
