/**
 * Dirty-chunk cache: pre-renders static map content (terrain, roads…) into
 * offscreen canvases of CHUNK_SIZE×CHUNK_SIZE tiles, redrawn only when
 * invalidated. Any layer can own one:
 *
 *   const cache = new ChunkCache({ pxPerTile: 16, drawChunk: (g, x0, y0, x1, y1, state, ppt) => … });
 *   registerLayer({ id, z, draw: (rc) => cache.draw(rc), invalidate: (r) => cache.invalidate(r) });
 *
 * drawChunk draws tiles [x0,x1)×[y0,y1) with (x0,y0) at canvas origin and
 * `ppt` pixels per tile.
 */
import { CHUNK_SIZE, TILE_SIZE } from '../core/constants';
import type { GameState, TileRect } from '../core/types';
import type { RenderContext } from './types';

export type DrawChunkFn = (g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, state: GameState, pxPerTile: number) => void;

interface Chunk {
  canvas: HTMLCanvasElement;
  dirty: boolean;
}

export class ChunkCache {
  private chunks = new Map<number, Chunk>();
  private stateRef: GameState | null = null;
  readonly pxPerTile: number;
  private drawChunk: DrawChunkFn;
  /** Max chunks redrawn per frame (spreads cost after big invalidations). */
  maxRedrawsPerFrame = 6;

  constructor(opts: { pxPerTile: number; drawChunk: DrawChunkFn }) {
    this.pxPerTile = opts.pxPerTile;
    this.drawChunk = opts.drawChunk;
  }

  /** Mark chunks overlapping rect dirty (null = all). */
  invalidate(rect: TileRect | null): void {
    if (!rect) {
      for (const c of this.chunks.values()) c.dirty = true;
      return;
    }
    const cx0 = Math.floor(rect.x / CHUNK_SIZE);
    const cy0 = Math.floor(rect.y / CHUNK_SIZE);
    const cx1 = Math.floor((rect.x + rect.w - 1) / CHUNK_SIZE);
    const cy1 = Math.floor((rect.y + rect.h - 1) / CHUNK_SIZE);
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = this.chunks.get(key(cx, cy));
        if (c) c.dirty = true;
      }
  }

  /** Drop all canvases (new map). */
  reset(): void {
    this.chunks.clear();
  }

  draw(rc: RenderContext): void {
    if (rc.state !== this.stateRef) {
      this.reset();
      this.stateRef = rc.state;
    }
    const { map } = rc.state;
    const cx0 = Math.floor(rc.view.x0 / CHUNK_SIZE);
    const cy0 = Math.floor(rc.view.y0 / CHUNK_SIZE);
    const cx1 = Math.floor((rc.view.x1 - 1) / CHUNK_SIZE);
    const cy1 = Math.floor((rc.view.y1 - 1) / CHUNK_SIZE);
    const g = rc.g;
    g.imageSmoothingEnabled = rc.zoom * TILE_SIZE < this.pxPerTile;
    let redraws = 0;
    const size = CHUNK_SIZE * TILE_SIZE;
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const k = key(cx, cy);
        let c = this.chunks.get(k);
        const x0 = cx * CHUNK_SIZE;
        const y0 = cy * CHUNK_SIZE;
        const x1 = Math.min(map.width, x0 + CHUNK_SIZE);
        const y1 = Math.min(map.height, y0 + CHUNK_SIZE);
        if (!c) {
          const canvas = document.createElement('canvas');
          canvas.width = (x1 - x0) * this.pxPerTile;
          canvas.height = (y1 - y0) * this.pxPerTile;
          c = { canvas, dirty: true };
          this.chunks.set(k, c);
        }
        if (c.dirty && redraws < this.maxRedrawsPerFrame) {
          const cg = c.canvas.getContext('2d')!;
          cg.clearRect(0, 0, c.canvas.width, c.canvas.height);
          this.drawChunk(cg, x0, y0, x1, y1, rc.state, this.pxPerTile);
          c.dirty = false;
          redraws++;
        }
        g.drawImage(c.canvas, cx * size, cy * size, (x1 - x0) * TILE_SIZE, (y1 - y0) * TILE_SIZE);
      }
  }
}

const key = (cx: number, cy: number): number => cy * 4096 + cx;
