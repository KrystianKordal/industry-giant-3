/**
 * 2D camera for top-down square tiles.
 * World space: pixels, 1 tile = TILE_SIZE px, tile (tx,ty) spans
 * [tx*TILE_SIZE, (tx+1)*TILE_SIZE). Camera (x,y) = world point at screen center.
 * Screen space: CSS pixels relative to the canvas.
 * Pure math — safe to construct headless.
 */
import { MAX_ZOOM, MIN_ZOOM, TILE_SIZE } from '../core/constants';
import type { TileView } from './types';

export class Camera {
  /** World px at screen center. */
  x = 0;
  y = 0;
  zoom = 1;
  /** Viewport size in CSS px. */
  viewW = 800;
  viewH = 600;
  /** Map size in tiles (for clamping). 0 = unbounded. */
  mapW = 0;
  mapH = 0;
  minZoom = MIN_ZOOM;
  maxZoom = MAX_ZOOM;

  setViewport(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
    this.clamp();
  }

  setBounds(mapW: number, mapH: number): void {
    this.mapW = mapW;
    this.mapH = mapH;
    this.clamp();
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.x) * this.zoom + this.viewW / 2, y: (wy - this.y) * this.zoom + this.viewH / 2 };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.viewW / 2) / this.zoom + this.x, y: (sy - this.viewH / 2) / this.zoom + this.y };
  }

  /** Fractional tile coords under a screen point (floor for the tile index). */
  screenToTile(sx: number, sy: number): { x: number; y: number } {
    const w = this.screenToWorld(sx, sy);
    return { x: w.x / TILE_SIZE, y: w.y / TILE_SIZE };
  }

  /** Screen position of a tile's top-left corner. */
  tileToScreen(tx: number, ty: number): { x: number; y: number } {
    return this.worldToScreen(tx * TILE_SIZE, ty * TILE_SIZE);
  }

  /** Pan by a screen-space delta (drag: pass -movement). */
  panBy(dxScreen: number, dyScreen: number): void {
    this.x += dxScreen / this.zoom;
    this.y += dyScreen / this.zoom;
    this.clamp();
  }

  /** Zoom by factor keeping the world point under (sx,sy) fixed. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }

  setZoom(z: number): void {
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, z));
    this.clamp();
  }

  /** Center on a tile (fractional OK; +0.5 for tile center). */
  centerOnTile(tx: number, ty: number): void {
    this.x = tx * TILE_SIZE;
    this.y = ty * TILE_SIZE;
    this.clamp();
  }

  /** Keep the camera center inside the map. */
  clamp(): void {
    if (this.mapW <= 0 || this.mapH <= 0) return;
    const w = this.mapW * TILE_SIZE;
    const h = this.mapH * TILE_SIZE;
    this.x = Math.min(w, Math.max(0, this.x));
    this.y = Math.min(h, Math.max(0, this.y));
  }

  /** Like visibleTiles but writes into `out` (no allocation). */
  visibleTilesInto(out: TileView, margin = 1): TileView {
    const hw = this.viewW / 2 / this.zoom;
    const hh = this.viewH / 2 / this.zoom;
    const maxX = this.mapW || Infinity;
    const maxY = this.mapH || Infinity;
    out.x0 = Math.max(0, Math.floor((this.x - hw) / TILE_SIZE) - margin);
    out.y0 = Math.max(0, Math.floor((this.y - hh) / TILE_SIZE) - margin);
    out.x1 = Math.min(maxX, Math.ceil((this.x + hw) / TILE_SIZE) + margin);
    out.y1 = Math.min(maxY, Math.ceil((this.y + hh) / TILE_SIZE) + margin);
    return out;
  }

  /** Visible tile range clamped to map, x1/y1 exclusive, with margin tiles. */
  visibleTiles(margin = 1): TileView {
    const tl = this.screenToTile(0, 0);
    const br = this.screenToTile(this.viewW, this.viewH);
    const maxX = this.mapW || Infinity;
    const maxY = this.mapH || Infinity;
    return {
      x0: Math.max(0, Math.floor(tl.x) - margin),
      y0: Math.max(0, Math.floor(tl.y) - margin),
      x1: Math.min(maxX, Math.ceil(br.x) + margin),
      y1: Math.min(maxY, Math.ceil(br.y) + margin),
    };
  }
}
