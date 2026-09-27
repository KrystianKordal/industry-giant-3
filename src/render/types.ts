/**
 * Render contracts: layers & render context. Owned by the render agent;
 * other modules may register layers (e.g. tool previews) through ctx.renderer.
 */
import type { GameContext } from '../core/context';
import type { GameState, TileRect } from '../core/types';
import type { DataRegistry } from '../data/registry';
import type { Camera } from './camera';

/** Visible tile range (x1/y1 exclusive), already clamped to the map. */
export interface TileView {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RenderContext {
  /** 2D context. For 'world' layers the camera transform is applied: 1 unit = 1 world px, tile = TILE_SIZE units. */
  g: CanvasRenderingContext2D;
  state: GameState;
  camera: Camera;
  /** Visible tiles (with 1-tile margin). Only draw what's inside! */
  view: TileView;
  zoom: number;
  /** performance.now() of this frame (ms) — for animations. */
  timeMs: number;
  /** ms since previous frame. */
  dtMs: number;
  /** Sim interpolation 0..1 between previous and current tick (vehicles: lerp prevX→x). */
  alpha: number;
  /** Canvas size in CSS px. */
  width: number;
  height: number;
  dpr: number;
  data: DataRegistry;
  ctx: GameContext;
}

/**
 * Layer z conventions (lower = drawn first):
 *   0 terrain · 5 deposits/terrain decals · 10 network (roads/rails) · 20 city houses
 *   30 buildings · 40 vehicles · 50 effects (smoke, particles) · 60 overlays/heatmaps
 *   70 labels · 80 selection · 90 tool preview · 100 hover · 1000+ screen-space (debug/fps)
 */
export interface LayerDef {
  id: string;
  z: number;
  /** 'world' (default): camera transform applied. 'screen': identity transform in CSS px. */
  space?: 'world' | 'screen';
  /** Skip drawing when this returns false. */
  visible?: (rc: RenderContext) => boolean;
  draw(rc: RenderContext): void;
  /** Called when tiles are invalidated (map/network change). rect null = everything. */
  invalidate?(rect: TileRect | null): void;
}
