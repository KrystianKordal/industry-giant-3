/**
 * Connection-mask → centreline geometry for linear tile features (roads, rails,
 * rivers, previews). Pieces are polylines in unit tile coordinates (0..1),
 * cached per mask. Dir bit order matches core `Dir`: N E S W NE SE SW NW.
 */
import { Dir } from '../core/types';

/** Edge/corner anchor per direction bit index (0..7). */
export const EDGE_PTS: readonly (readonly [number, number])[] = [
  [0.5, 0], // N
  [1, 0.5], // E
  [0.5, 1], // S
  [0, 0.5], // W
  [1, 0], // NE
  [1, 1], // SE
  [0, 1], // SW
  [0, 0], // NW
];

/** Neighbour offsets per bit index. */
export const DIR_OFF: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

/** Bit index of the opposite direction. */
export const OPPOSITE = [2, 3, 0, 1, 6, 7, 4, 5] as const;

export interface Piece {
  /** x,y pairs in unit tile coords. */
  pts: Float32Array;
  /** True for an edge-to-edge straight line. */
  straight: boolean;
  /** Tile-edge → centre stub (dead end / junction arm). */
  arm: boolean;
}

const cache: (Piece[] | undefined)[] = new Array(256);

function line(ax: number, ay: number, bx: number, by: number, straight: boolean, arm: boolean): Piece {
  return { pts: new Float32Array([ax, ay, bx, by]), straight, arm };
}

function curve(ax: number, ay: number, bx: number, by: number): Piece {
  const n = 8;
  const pts = new Float32Array((n + 1) * 2);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts[i * 2] = u * u * ax + 2 * u * t * 0.5 + t * t * bx;
    pts[i * 2 + 1] = u * u * ay + 2 * u * t * 0.5 + t * t * by;
  }
  return { pts, straight: false, arm: false };
}

/** Pieces for a connection mask (8-bit, Dir bits). mask 0 → [] (caller draws a dot). */
export function piecesFor(mask: number): Piece[] {
  mask &= 255;
  const hit = cache[mask];
  if (hit) return hit;
  const dirs: number[] = [];
  for (let b = 0; b < 8; b++) if (mask & (1 << b)) dirs.push(b);
  const out: Piece[] = [];
  if (dirs.length === 1) {
    const [x, y] = EDGE_PTS[dirs[0]!]!;
    out.push(line(x, y, 0.5, 0.5, false, true));
  } else if (dirs.length === 2) {
    const [a, b] = dirs as [number, number];
    const [ax, ay] = EDGE_PTS[a]!;
    const [bx, by] = EDGE_PTS[b]!;
    if (OPPOSITE[a] === b) out.push(line(ax, ay, bx, by, true, false));
    else out.push(curve(ax, ay, bx, by));
  } else if (dirs.length > 2) {
    // pair straight-through opposites, the rest are arms to the centre
    const used = new Set<number>();
    for (const a of dirs) {
      const o = OPPOSITE[a]!;
      if (!used.has(a) && dirs.includes(o) && !used.has(o)) {
        used.add(a);
        used.add(o);
        const [ax, ay] = EDGE_PTS[a]!;
        const [bx, by] = EDGE_PTS[o]!;
        out.push(line(ax, ay, bx, by, true, false));
      }
    }
    for (const a of dirs) {
      if (used.has(a)) continue;
      const [x, y] = EDGE_PTS[a]!;
      out.push(line(x, y, 0.5, 0.5, false, true));
    }
  }
  cache[mask] = out;
  return out;
}

/** Offset a polyline sideways by d (unit coords, + = right of travel direction). */
export function offsetPolyline(pts: Float32Array, d: number): Float32Array {
  const n = pts.length / 2;
  const out = new Float32Array(pts.length);
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    let dx = pts[i1 * 2]! - pts[i0 * 2]!;
    let dy = pts[i1 * 2 + 1]! - pts[i0 * 2 + 1]!;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    out[i * 2] = pts[i * 2]! - dy * d;
    out[i * 2 + 1] = pts[i * 2 + 1]! + dx * d;
  }
  return out;
}

const offCache = new Map<string, Float32Array>();
/** Cached offset of a piece (keyed by mask/piece index/offset). */
export function pieceOffset(mask: number, idx: number, d: number): Float32Array {
  const k = `${mask}|${idx}|${d}`;
  let v = offCache.get(k);
  if (!v) {
    v = offsetPolyline(piecesFor(mask)[idx]!.pts, d);
    offCache.set(k, v);
  }
  return v;
}

/** Append a piece polyline to a path at tile (tx,ty), `s` world units per tile. */
export function addPts(p: Path2D | CanvasRenderingContext2D, pts: Float32Array, tx: number, ty: number, s: number): void {
  p.moveTo((tx + pts[0]!) * s, (ty + pts[1]!) * s);
  for (let i = 2; i < pts.length; i += 2) p.lineTo((tx + pts[i]!) * s, (ty + pts[i + 1]!) * s);
}

/** 4-dir mask derived from neighbours satisfying `has(x,y)`. */
export function deriveMask4(x: number, y: number, has: (x: number, y: number) => boolean): number {
  let m = 0;
  if (has(x, y - 1)) m |= Dir.N;
  if (has(x + 1, y)) m |= Dir.E;
  if (has(x, y + 1)) m |= Dir.S;
  if (has(x - 1, y)) m |= Dir.W;
  return m;
}

/** Direction bit (Dir.*) from (x0,y0) to adjacent (x1,y1) (8-neighbourhood), 0 if not adjacent. */
export function dirBetween(x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  for (let b = 0; b < 8; b++) if (DIR_OFF[b]![0] === dx && DIR_OFF[b]![1] === dy) return 1 << b;
  return 0;
}
