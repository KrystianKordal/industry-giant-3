/**
 * Render contracts: layers, render context, overlays, effects. Owned by the
 * render agent; other modules may register layers (e.g. tool previews) through
 * ctx.renderer and use `rc.helpers` (see render/preview.ts) inside drawPreview.
 */
import type { GameContext } from '../core/context';
import type { GameState, TileRect } from '../core/types';
import type { DataRegistry } from '../data/registry';
import type { Camera } from './camera';
import type { RenderHelpers } from './preview';

/** Visible tile range (x1/y1 exclusive), already clamped to the map. */
export interface TileView {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Semantic zoom level derived from CSS px per tile (`rc.ppt`):
 *  - 'far'   (< 12 px/tile): simplified shapes, big icons, flow lines, city labels
 *  - 'mid'   (12–28 px/tile): full shapes, fewer details, no fine animation
 *  - 'close' (≥ 28 px/tile): all details & animations
 */
export type DetailLevel = 'far' | 'mid' | 'close';

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
  /** CSS px per tile on screen (= zoom × TILE_SIZE). */
  ppt: number;
  /** Semantic zoom bucket (see DetailLevel). */
  detail: DetailLevel;
  /** 0 = day … 1 = deepest night (0 when the day/night cycle is disabled). */
  night: number;
  /** Animations allowed (false with userSettings.reducedMotion). */
  motion: boolean;
  /** Drawing helpers for tool previews / highlights (render/preview.ts). */
  helpers: RenderHelpers;
}

/**
 * Layer z conventions (lower = drawn first):
 *   0 terrain (+houses, trees, rivers, deposit markers — chunk cached) · 2 water animation
 *   10 network (roads/rails/bridges) · 30 buildings · 40 vehicles · 50 effects (smoke, particles)
 *   55 night tint (screen) · 56 night lights · 57 weather · 60 overlays/heatmaps · 62 route flows
 *   65 grid · 66 tilt-shift (screen) · 70 labels (screen) · 72 floating texts (screen)
 *   80 selection · 90 tool preview (input) · 100 hover (input) · 1000+ screen-space (debug/fps)
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

// ---------------------------------------------------------------- overlays

export interface OverlayLegendCategory {
  label: string;
  color: string;
  icon?: string;
}

/**
 * Legend data for UI. `kind: 'gradient'` → colour bar from `stops` between
 * minLabel/maxLabel; `kind: 'categories'` → list of swatches.
 */
export interface OverlayLegend {
  kind: 'gradient' | 'categories';
  /** Current numeric range of the data (may change over time). */
  min: number;
  max: number;
  /** Unit label, e.g. 'zł/mies.', '%', 'jedn.'. */
  unit: string;
  /** Colour ramp, t in 0..1 (CSS colours). */
  stops: { t: number; color: string }[];
  minLabel: string;
  maxLabel: string;
  categories?: OverlayLegendCategory[];
  /** Optional hint shown under the legend. */
  note?: string;
}

export interface OverlayInfo {
  /** Id passed to ctx.renderer.setOverlay(id). */
  id: string;
  /** Polish name for the UI button. */
  name: string;
  icon: string;
  description: string;
  legend: OverlayLegend;
}

// ---------------------------------------------------------------- effects

export type EffectKind = 'smoke' | 'steam' | 'dust' | 'sparkle' | 'splash' | 'text' | 'icon' | 'coins';

export interface EffectOptions {
  /** Number of particles (default by kind). */
  count?: number;
  /** Text for 'text', emoji for 'icon'. */
  text?: string;
  /** CSS colour (text / tint). */
  color?: string;
  /** Size multiplier. */
  scale?: number;
}

/** Frame timing statistics (ms, exponential moving averages). */
export interface RenderStats {
  fps: number;
  /** Total CPU time of a frame (all layers). */
  frameMs: number;
  /** Per layer average ms. */
  layerMs: Record<string, number>;
  /** Terrain chunk cache (count, pixels, redraw ms, current LOD). */
  chunks: { chunks: number; pixels: number; redraws: number; redrawMs: number; lod: number };
}
