/**
 * Canvas 2D renderer: requestAnimationFrame loop independent from the sim,
 * layer registry (sorted by z), camera, dirty-rect invalidation.
 */
import { TILE_SIZE } from '../core/constants';
import type { GameContext, RendererApi } from '../core/context';
import type { TileRect } from '../core/types';
import { Camera } from './camera';
import type { LayerDef, RenderContext } from './types';

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

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly ctx: GameContext,
  ) {
    const g = canvas.getContext('2d', { alpha: false });
    if (!g) throw new Error('Canvas 2D niedostępny');
    this.g = g;

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
      this.lastCam = { x: cam.x, y: cam.y, zoom: cam.zoom };
      this.ctx.bus.emit('camera:changed', { x: cam.x, y: cam.y, zoom: cam.zoom });
    }

    const rc: RenderContext = {
      g,
      state,
      camera: cam,
      view: cam.visibleTiles(1),
      zoom: cam.zoom,
      timeMs: t,
      dtMs: dt,
      alpha: this.ctx.sim.alpha,
      width: cam.viewW,
      height: cam.viewH,
      dpr,
      data: this.ctx.data,
      ctx: this.ctx,
    };
    const z = cam.zoom * dpr;
    for (const layer of this.layers) {
      if (this.hidden.has(layer.id)) continue;
      if (layer.visible && !layer.visible(rc)) continue;
      g.save();
      if ((layer.space ?? 'world') === 'world') g.setTransform(z, 0, 0, z, dpr * (cam.viewW / 2 - cam.x * cam.zoom), dpr * (cam.viewH / 2 - cam.y * cam.zoom));
      else g.setTransform(dpr, 0, 0, dpr, 0, 0);
      try {
        layer.draw(rc);
      } catch (err) {
        console.error(`[render] layer "${layer.id}" failed`, err);
        this.hidden.add(layer.id);
      }
      g.restore();
    }
  }
}

/** Helper: world px of a tile's top-left. */
export const tileToWorld = (t: number): number => t * TILE_SIZE;
