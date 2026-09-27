/**
 * Canvas 2D renderer: requestAnimationFrame loop independent from the sim,
 * layer registry (sorted by z), camera, dirty-rect invalidation, overlays,
 * effects, frame statistics. The loop redraws every frame, so no explicit
 * "request redraw" is needed — cached layers only need `invalidate(rect)`
 * (done automatically on map:changed / network:changed).
 */
import { TILE_SIZE } from '../core/constants';
import type { GameContext, RendererApi } from '../core/context';
import type { TileRect } from '../core/types';
import { Camera } from './camera';
import { createEffects, type Effects } from './effects';
import { dayNight } from './layers/atmosphere';
import { terrainCacheRef } from './layers/terrain';
import { OverlayManager } from './overlays';
import { helpers } from './preview';
import type { DetailLevel, EffectKind, EffectOptions, LayerDef, OverlayInfo, RenderContext, RenderStats } from './types';

/** CSS px per tile thresholds of the semantic zoom. */
export const DETAIL_FAR = 12;
export const DETAIL_CLOSE = 28;

export class Renderer implements RendererApi {
  readonly camera = new Camera();
  overlay: string | null = null;
  fps = 0;
  private layers: LayerDef[] = [];
  private hidden = new Set<string>();
  private frameCbs = new Set<(dtMs: number) => void>();
  private g: CanvasRenderingContext2D;
  private raf = 0;
  private last = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private lastCam = { x: NaN, y: NaN, zoom: NaN };
  private dpr = 1;
  private errors = new Map<string, number>();
  readonly overlays: OverlayManager;
  readonly fx: Effects;
  /** Layers owned by the effects system (registered by render/index.ts). */
  readonly fxLayers: LayerDef[];
  readonly stats: RenderStats = { fps: 0, frameMs: 0, layerMs: {}, chunks: { chunks: 0, pixels: 0, redraws: 0, redrawMs: 0, lod: 0 } };
  private rc: RenderContext | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly ctx: GameContext,
  ) {
    const g = canvas.getContext('2d', { alpha: false });
    if (!g) throw new Error('Canvas 2D niedostępny');
    this.g = g;
    this.overlays = new OverlayManager(ctx);
    const e = createEffects(ctx);
    this.fx = e.fx;
    this.fxLayers = e.layers;

    ctx.bus.on('game:started', ({ state }) => {
      this.camera.setBounds(state.map.width, state.map.height);
      this.camera.x = state.view.camX;
      this.camera.y = state.view.camY;
      this.camera.setZoom(state.view.zoom);
      this.overlay = state.view.overlay;
      this.invalidate(null);
    });
    ctx.bus.on('game:beforeSave', ({ state }) => {
      state.view.camX = this.camera.x;
      state.view.camY = this.camera.y;
      state.view.zoom = this.camera.zoom;
      state.view.overlay = this.overlay;
    });
    ctx.bus.on('map:changed', (r) => this.invalidate(r));
    ctx.bus.on('network:changed', ({ tiles }) => {
      const st = ctx.tryState();
      if (!st || tiles.length === 0) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const i of tiles) {
        const x = i % st.map.width;
        const y = (i / st.map.width) | 0;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
      this.invalidate({ x: x0 - 1, y: y0 - 1, w: x1 - x0 + 3, h: y1 - y0 + 3 });
    });
    ctx.bus.on('camera:focus', ({ x, y, zoom }) => this.centerOn(x, y, zoom));
  }

  // ------------------------------------------------------------ RendererApi
  registerLayer(def: LayerDef): void {
    this.layers = this.layers.filter((l) => l.id !== def.id);
    this.layers.push(def);
    this.layers.sort((a, b) => a.z - b.z);
  }
  unregisterLayer(id: string): void {
    this.layers = this.layers.filter((l) => l.id !== id);
  }
  setLayerVisible(id: string, visible: boolean): void {
    if (visible) this.hidden.delete(id);
    else this.hidden.add(id);
  }
  layerIds(): string[] {
    return this.layers.map((l) => l.id);
  }
  invalidate(rect: TileRect | null = null): void {
    for (const l of this.layers) l.invalidate?.(rect);
  }
  centerOn(x: number, y: number, zoom?: number): void {
    if (zoom !== undefined) this.camera.setZoom(zoom);
    this.camera.centerOnTile(x + 0.5, y + 0.5);
  }
  setOverlay(id: string | null): void {
    if (this.overlay === id) return;
    this.overlay = id;
    const st = this.ctx.tryState();
    if (st) st.view.overlay = id;
    this.ctx.bus.emit('overlay:changed', { overlay: id });
  }
  onFrame(fn: (dtMs: number) => void): () => void {
    this.frameCbs.add(fn);
    return () => this.frameCbs.delete(fn);
  }
  listOverlays(): OverlayInfo[] {
    return this.overlays.list();
  }
  overlayInfo(id?: string | null): OverlayInfo | null {
    return this.overlays.info(id === undefined ? this.overlay : id);
  }
  effect(kind: EffectKind, x: number, y: number, opts?: EffectOptions): void {
    if (this.ctx.userSettings.reducedMotion && kind !== 'text' && kind !== 'icon') return;
    this.fx.spawn(kind, x, y, opts);
  }
  /** Semantic zoom bucket for a zoom level. */
  detailFor(zoom: number): DetailLevel {
    const p = zoom * TILE_SIZE;
    return p < DETAIL_FAR ? 'far' : p < DETAIL_CLOSE ? 'mid' : 'close';
  }

  // ------------------------------------------------------------ loop
  start(): void {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (t: number): void => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(100, t - this.last);
      this.last = t;
      this.frame(t, dt);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph || this.dpr !== dpr) {
      this.canvas.width = pw;
      this.canvas.height = ph;
      this.dpr = dpr;
    }
    if (this.camera.viewW !== w || this.camera.viewH !== h) this.camera.setViewport(w, h);
  }

  private frame(t: number, dt: number): void {
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 500) {
      this.fps = Math.round((this.fpsFrames * 1000) / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    this.resize();
    for (const fn of this.frameCbs) {
      try {
        fn(dt);
      } catch (err) {
        console.error('[render] onFrame callback failed', err);
      }
    }
    const g = this.g;
    const cam = this.camera;
    const dpr = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0b0f14';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const state = this.ctx.tryState();
    if (!state) return;

    if (cam.x !== this.lastCam.x || cam.y !== this.lastCam.y || cam.zoom !== this.lastCam.zoom) {
      this.lastCam.x = cam.x;
      this.lastCam.y = cam.y;
      this.lastCam.zoom = cam.zoom;
      this.ctx.bus.emit('camera:changed', { x: cam.x, y: cam.y, zoom: cam.zoom });
    }

    let rc = this.rc;
    if (!rc) {
      rc = this.rc = {
        g,
        state,
        camera: cam,
        view: { x0: 0, y0: 0, x1: 0, y1: 0 },
        zoom: 1,
        timeMs: 0,
        dtMs: 0,
        alpha: 0,
        width: 0,
        height: 0,
        dpr,
        data: this.ctx.data,
        ctx: this.ctx,
        ppt: TILE_SIZE,
        detail: 'close',
        night: 0,
        motion: true,
        helpers,
      };
    }
    rc.state = state;
    cam.visibleTilesInto(rc.view, 1);
    rc.zoom = cam.zoom;
    rc.timeMs = t;
    rc.dtMs = dt;
    rc.alpha = this.ctx.sim.alpha;
    rc.width = cam.viewW;
    rc.height = cam.viewH;
    rc.dpr = dpr;
    rc.data = this.ctx.data;
    rc.ppt = cam.zoom * TILE_SIZE;
    rc.detail = this.detailFor(cam.zoom);
    rc.night = this.ctx.userSettings.dayNightCycle ? dayNight(state).night : 0;
    rc.motion = !this.ctx.userSettings.reducedMotion;

    const t0 = performance.now();
    const z = cam.zoom * dpr;
    const lm = this.stats.layerMs;
    for (const layer of this.layers) {
      if (this.hidden.has(layer.id)) continue;
      if (layer.visible && !layer.visible(rc)) continue;
      const l0 = performance.now();
      g.save();
      if ((layer.space ?? 'world') === 'world') g.setTransform(z, 0, 0, z, dpr * (cam.viewW / 2 - cam.x * cam.zoom), dpr * (cam.viewH / 2 - cam.y * cam.zoom));
      else g.setTransform(dpr, 0, 0, dpr, 0, 0);
      try {
        layer.draw(rc);
      } catch (err) {
        const n = (this.errors.get(layer.id) ?? 0) + 1;
        this.errors.set(layer.id, n);
        console.error(`[render] layer "${layer.id}" failed (${n})`, err);
        if (n >= 3) this.hidden.add(layer.id);
      }
      g.restore();
      const ms = performance.now() - l0;
      lm[layer.id] = (lm[layer.id] ?? ms) * 0.92 + ms * 0.08;
    }
    const ms = performance.now() - t0;
    this.stats.frameMs = this.stats.frameMs * 0.92 + ms * 0.08;
    this.stats.fps = this.fps;
    const cs = terrainCacheRef?.stats;
    if (cs) {
      const c = this.stats.chunks;
      c.chunks = cs.chunks;
      c.pixels = cs.pixels;
      c.redraws = cs.redraws;
      c.redrawMs = cs.redrawMs;
      c.lod = cs.lod;
    }
  }
}

/** Helper: world px of a tile's top-left. */
export const tileToWorld = (t: number): number => t * TILE_SIZE;
