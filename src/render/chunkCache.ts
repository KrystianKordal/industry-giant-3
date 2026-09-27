/**
 * Multi-LOD dirty-chunk cache: pre-renders static map content (terrain, trees,
 * houses…) into offscreen canvases, one set per level of detail, redrawn only
 * when invalidated and within a per-frame time budget.
 *
 *   const cache = new ChunkCache({
 *     lods: [{ ppt: 8, tiles: 32 }, { ppt: 32, tiles: 32 }],
 *     drawChunk: (g, x0, y0, x1, y1, state, ppt, lod) => …,
 *   });
 *   registerLayer({ id, z, draw: (rc) => cache.draw(rc), invalidate: (r) => cache.invalidate(r) });
 *
 * drawChunk draws tiles [x0,x1)×[y0,y1) with (x0,y0) at the canvas origin and
 * `ppt` canvas pixels per tile. LOD 0 (the coarsest) is kept for every chunk
 * ever drawn and is used as the fallback while a finer chunk is not ready yet;
 * finer LODs are evicted LRU when their total pixel count exceeds `maxPixels`.
 * Legacy single-LOD form `new ChunkCache({ pxPerTile, drawChunk })` still works.
 */
import { CHUNK_SIZE, TILE_SIZE } from '../core/constants';
import type { GameState, TileRect } from '../core/types';
import type { RenderContext } from './types';

export type DrawChunkFn = (
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  state: GameState,
  pxPerTile: number,
  lod: number,
) => void;

export interface LodSpec {
  /** Canvas pixels per tile. */
  ppt: number;
  /** Tiles per chunk side. Must divide the LOD-0 chunk size. */
  tiles: number;
}

interface Chunk {
  canvas: HTMLCanvasElement;
  dirty: boolean;
  drawn: boolean;
  lastUsed: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ChunkCacheStats {
  chunks: number;
  pixels: number;
  redraws: number;
  redrawMs: number;
  lod: number;
}

export class ChunkCache {
  readonly lods: LodSpec[];
  /** Kept for backwards compatibility (ppt of the finest LOD). */
  readonly pxPerTile: number;
  private maps: Map<number, Chunk>[];
  private stateRef: GameState | null = null;
  private drawChunk: DrawChunkFn;
  private frame = 0;
  private finePixels = 0;
  /** Milliseconds per frame spent (re)drawing chunks, beyond the mandatory ones. */
  budgetMs: number;
  /** Max canvas pixels kept for LOD > 0 (LRU eviction). */
  maxPixels: number;
  /** Pre-render LOD 0 of the whole map in spare frame time. */
  prewarm = true;
  private warmCursor = 0;
  /** Legacy option: max chunk redraws per frame (0 = time budget only). */
  maxRedrawsPerFrame = 0;
  readonly stats: ChunkCacheStats = { chunks: 0, pixels: 0, redraws: 0, redrawMs: 0, lod: 0 };

  constructor(opts: { lods?: LodSpec[]; pxPerTile?: number; drawChunk: DrawChunkFn; budgetMs?: number; maxPixels?: number }) {
    this.lods = opts.lods ?? [{ ppt: opts.pxPerTile ?? 16, tiles: CHUNK_SIZE }];
    this.pxPerTile = this.lods[this.lods.length - 1]!.ppt;
    this.drawChunk = opts.drawChunk;
    this.budgetMs = opts.budgetMs ?? 7;
    this.maxPixels = opts.maxPixels ?? 26e6;
    this.maps = this.lods.map(() => new Map());
  }

  /** Mark chunks overlapping rect dirty (null = all). */
  invalidate(rect: TileRect | null): void {
    for (let l = 0; l < this.lods.length; l++) {
      const map = this.maps[l]!;
      if (!rect) {
        for (const c of map.values()) c.dirty = true;
        continue;
      }
      const size = this.lods[l]!.tiles;
      const cx0 = Math.floor(rect.x / size);
      const cy0 = Math.floor(rect.y / size);
      const cx1 = Math.floor((rect.x + rect.w - 1) / size);
      const cy1 = Math.floor((rect.y + rect.h - 1) / size);
      for (let cy = cy0; cy <= cy1; cy++)
        for (let cx = cx0; cx <= cx1; cx++) {
          const c = map.get(key(cx, cy));
          if (c) c.dirty = true;
        }
    }
  }

  /** Drop all canvases (new map). */
  reset(): void {
    for (const m of this.maps) {
      for (const c of m.values()) release(c);
      m.clear();
    }
    this.finePixels = 0;
  }

  /** Choose the LOD for a screen density (device px per tile). */
  pickLod(screenPpt: number): number {
    let best = this.lods.length - 1;
    for (let l = 0; l < this.lods.length; l++)
      if (this.lods[l]!.ppt >= screenPpt / 1.45) {
        best = l;
        break;
      }
    return best;
  }

  /** Draw visible chunks. `forceLod` overrides automatic LOD choice. */
  draw(rc: RenderContext, forceLod?: number): void {
    if (rc.state !== this.stateRef) {
      this.reset();
      this.stateRef = rc.state;
    }
    this.frame++;
    const t0 = performance.now();
    const st = this.stats;
    st.redraws = 0;
    const lod = forceLod ?? this.pickLod(rc.zoom * TILE_SIZE * rc.dpr);
    st.lod = lod;
    const spec = this.lods[lod]!;
    const size = spec.tiles;
    const { map } = rc.state;
    const v = rc.view;
    const cx0 = Math.floor(v.x0 / size);
    const cy0 = Math.floor(v.y0 / size);
    const cx1 = Math.floor((v.x1 - 1) / size);
    const cy1 = Math.floor((v.y1 - 1) / size);
    const g = rc.g;
    g.imageSmoothingEnabled = true;
    const ov = 0.75 / Math.max(0.01, rc.zoom * rc.dpr);
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = this.ensure(lod, cx, cy, map.width, map.height);
        if (!c) continue;
        c.lastUsed = this.frame;
        if (c.dirty) {
          const mandatory = !c.drawn && lod === 0;
          if (mandatory || performance.now() - t0 < this.budgetMs) this.render(c, lod, rc.state);
        }
        const wx = c.x0 * TILE_SIZE;
        const wy = c.y0 * TILE_SIZE;
        const ww = (c.x1 - c.x0) * TILE_SIZE;
        const wh = (c.y1 - c.y0) * TILE_SIZE;
        if (c.drawn) {
          g.drawImage(c.canvas, wx, wy, ww + ov, wh + ov);
        } else {
          // fallback: region from the coarsest LOD
          this.drawFallback(g, c, rc.state, ov);
        }
      }
    // idle prewarm: coarsest LOD for the whole map (fallback + fast zoom-out)
    if (this.prewarm && performance.now() - t0 < this.budgetMs * 0.6) {
      const size0 = this.lods[0]!.tiles;
      const ncx = Math.ceil(map.width / size0);
      const ncy = Math.ceil(map.height / size0);
      const total = ncx * ncy;
      for (let n = 0; n < total && performance.now() - t0 < this.budgetMs * 0.6; n++) {
        const k = this.warmCursor++ % total;
        const c = this.ensure(0, k % ncx, (k / ncx) | 0, map.width, map.height);
        if (c && c.dirty) this.render(c, 0, rc.state);
      }
    }
    if (this.finePixels > this.maxPixels) this.evict();
    st.redrawMs = performance.now() - t0;
    let n = 0;
    for (const m of this.maps) n += m.size;
    st.chunks = n;
    st.pixels = this.finePixels;
  }

  private ensure(lod: number, cx: number, cy: number, W: number, H: number): Chunk | null {
    const m = this.maps[lod]!;
    const k = key(cx, cy);
    let c = m.get(k);
    if (c) return c;
    const size = this.lods[lod]!.tiles;
    const x0 = cx * size;
    const y0 = cy * size;
    if (x0 >= W || y0 >= H || x0 < 0 || y0 < 0) return null;
    const x1 = Math.min(W, x0 + size);
    const y1 = Math.min(H, y0 + size);
    const canvas = document.createElement('canvas');
    const ppt = this.lods[lod]!.ppt;
    canvas.width = (x1 - x0) * ppt;
    canvas.height = (y1 - y0) * ppt;
    c = { canvas, dirty: true, drawn: false, lastUsed: this.frame, x0, y0, x1, y1 };
    m.set(k, c);
    if (lod > 0) this.finePixels += canvas.width * canvas.height;
    return c;
  }

  private render(c: Chunk, lod: number, state: GameState): void {
    const g = c.canvas.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.canvas.width, c.canvas.height);
    g.save();
    try {
      this.drawChunk(g, c.x0, c.y0, c.x1, c.y1, state, this.lods[lod]!.ppt, lod);
    } catch (err) {
      console.error('[render] chunk draw failed', err);
    }
    g.restore();
    c.dirty = false;
    c.drawn = true;
    this.stats.redraws++;
  }

  private drawFallback(g: CanvasRenderingContext2D, c: Chunk, state: GameState, ov: number): void {
    const base = this.lods[0]!;
    const size = base.tiles;
    const W = state.map.width;
    const H = state.map.height;
    for (let cy = Math.floor(c.y0 / size); cy <= Math.floor((c.y1 - 1) / size); cy++)
      for (let cx = Math.floor(c.x0 / size); cx <= Math.floor((c.x1 - 1) / size); cx++) {
        const b = this.ensure(0, cx, cy, W, H);
        if (!b) continue;
        b.lastUsed = this.frame;
        if (!b.drawn) this.render(b, 0, state);
        const x0 = Math.max(b.x0, c.x0);
        const y0 = Math.max(b.y0, c.y0);
        const x1 = Math.min(b.x1, c.x1);
        const y1 = Math.min(b.y1, c.y1);
        g.drawImage(
          b.canvas,
          (x0 - b.x0) * base.ppt,
          (y0 - b.y0) * base.ppt,
          (x1 - x0) * base.ppt,
          (y1 - y0) * base.ppt,
          x0 * TILE_SIZE,
          y0 * TILE_SIZE,
          (x1 - x0) * TILE_SIZE + ov,
          (y1 - y0) * TILE_SIZE + ov,
        );
      }
  }

  private evict(): void {
    const cands: { lod: number; k: number; c: Chunk }[] = [];
    for (let l = 1; l < this.maps.length; l++)
      for (const [k, c] of this.maps[l]!) if (c.lastUsed < this.frame) cands.push({ lod: l, k, c });
    cands.sort((a, b) => a.c.lastUsed - b.c.lastUsed);
    for (const e of cands) {
      if (this.finePixels <= this.maxPixels * 0.85) break;
      this.finePixels -= e.c.canvas.width * e.c.canvas.height;
      release(e.c);
      this.maps[e.lod]!.delete(e.k);
    }
  }
}

function release(c: Chunk): void {
  c.canvas.width = 0;
  c.canvas.height = 0;
}

const key = (cx: number, cy: number): number => cy * 4096 + cx;
