/**
 * Minimap: terrain + network + buildings (owner colour) + cities, camera
 * viewport rectangle, click/drag to jump. Optional overlay mode tints tiles
 * using the active OverlayDef.minimapColor. Base image refreshed ~1×/s.
 */
import { TILE_SIZE } from '../core/constants';
import type { GameContext } from '../core/context';
import type { GameState } from '../core/types';
import { h } from './dom';
import { hexToRgb } from './overlays';
import { tooltip } from './tooltip';
import type { UiManager } from './ui';

const SIZE = 196;

export function installMinimap(ctx: GameContext, ui: UiManager): void {
  const canvas = h('canvas', { class: 'ig-minimap-canvas' });
  const overlayBtn = h('button', { class: 'ig-mm-btn', onclick: () => toggleOverlayMode() }, '🗺️');
  tooltip(overlayBtn, 'Pokaż aktywną nakładkę na minimapie');
  const zoomBtn = h('button', { class: 'ig-mm-btn', onclick: () => ctx.renderer.centerOn(ctx.state.map.width / 2, ctx.state.map.height / 2, 0.25) }, '⤢');
  tooltip(zoomBtn, 'Pokaż całą mapę');
  const hideBtn = h('button', { class: 'ig-mm-btn', onclick: () => setVisible(false) }, '–');
  tooltip(hideBtn, 'Ukryj minimapę [M]');
  const wrap = h('div', { class: 'ig-minimap' }, h('div', { class: 'ig-minimap-tools' }, overlayBtn, zoomBtn, hideBtn), canvas);
  const showBtn = h('button', { class: 'ig-minimap-show', onclick: () => setVisible(true) }, '🗺️');
  tooltip(showBtn, 'Pokaż minimapę [M]');
  ui.root.append(wrap, showBtn);

  let visible = true;
  let overlayMode = true;
  let base: HTMLCanvasElement | null = null;
  let baseState: GameState | null = null;
  let dirtyTerrain = true;
  let scale = 1;
  let lastBuild = 0;

  const setVisible = (v: boolean): void => {
    visible = v;
    document.body.classList.toggle('ig-minimap-hidden', !v);
    if (v) redraw(true);
  };
  const toggleOverlayMode = (): void => {
    overlayMode = !overlayMode;
    overlayBtn.classList.toggle('active', overlayMode);
    redraw(true);
  };
  overlayBtn.classList.toggle('active', overlayMode);

  // cached terrain rgba per tile
  let terrainRgba: Uint8ClampedArray | null = null;
  const buildTerrain = (st: GameState): void => {
    const m = st.map;
    const n = m.width * m.height;
    const out = new Uint8ClampedArray(n * 4);
    const pal = ctx.data.terrain.map((t) => hexToRgb(t.color));
    for (let i = 0; i < n; i++) {
      const c = pal[m.terrain[i]!] ?? [100, 100, 100];
      const e = (m.elevation[i]! - 128) / 255;
      const shade = 1 + e * 0.35;
      out[i * 4] = c[0] * shade;
      out[i * 4 + 1] = c[1] * shade;
      out[i * 4 + 2] = c[2] * shade;
      out[i * 4 + 3] = 255;
    }
    terrainRgba = out;
    dirtyTerrain = false;
  };

  const buildBase = (): void => {
    const st = ctx.tryState();
    if (!st) return;
    const m = st.map;
    if (baseState !== st) {
      baseState = st;
      dirtyTerrain = true;
    }
    if (dirtyTerrain || !terrainRgba) buildTerrain(st);
    if (!base) base = document.createElement('canvas');
    if (base.width !== m.width || base.height !== m.height) {
      base.width = m.width;
      base.height = m.height;
    }
    const g = base.getContext('2d')!;
    const img = g.createImageData(m.width, m.height);
    const px = img.data;
    px.set(terrainRgba!);
    const n = m.width * m.height;
    const { road, rail } = st.network;
    // cities (houses) & network
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (m.house[i]) {
        const v = 150 + m.house[i]! * 12;
        px[o] = v;
        px[o + 1] = v - 10;
        px[o + 2] = v - 25;
      }
      if (rail[i]) {
        px[o] = 60;
        px[o + 1] = 55;
        px[o + 2] = 60;
      } else if (road[i]) {
        px[o] = 195;
        px[o + 1] = 180;
        px[o + 2] = 150;
      }
    }
    // buildings in owner colour
    const colors = new Map<number, [number, number, number]>();
    for (const c of Object.values(st.companies)) colors.set(c.id, hexToRgb(c.color.startsWith('#') ? c.color : '#e8b04a'));
    for (const b of Object.values(st.buildings)) {
      const c = colors.get(b.owner) ?? [220, 220, 220];
      for (let y = b.y; y < b.y + b.h; y++)
        for (let x = b.x; x < b.x + b.w; x++) {
          if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue;
          const o = (y * m.width + x) * 4;
          px[o] = c[0];
          px[o + 1] = c[1];
          px[o + 2] = c[2];
        }
    }
    // overlay tint
    const ov = overlayMode ? ui.overlayDef(ctx.renderer.overlay) : undefined;
    if (ov?.minimapColor) {
      for (let i = 0; i < n; i++) {
        let c: [number, number, number, number] | null = null;
        try {
          c = ov.minimapColor(st, i, ctx);
        } catch {
          c = null;
        }
        const o = i * 4;
        if (!c) {
          // dim untinted tiles so the overlay stands out
          px[o] = px[o]! * 0.55;
          px[o + 1] = px[o + 1]! * 0.55;
          px[o + 2] = px[o + 2]! * 0.55;
          continue;
        }
        const a = c[3] / 255;
        px[o] = px[o]! * (1 - a) + c[0] * a;
        px[o + 1] = px[o + 1]! * (1 - a) + c[1] * a;
        px[o + 2] = px[o + 2]! * (1 - a) + c[2] * a;
      }
    }
    g.putImageData(img, 0, 0);
    lastBuild = performance.now();
  };

  const redraw = (rebuild = false): void => {
    const st = ctx.tryState();
    if (!st || !visible) return;
    if (rebuild || !base || performance.now() - lastBuild > 1000) buildBase();
    const m = st.map;
    const aspect = m.width / m.height;
    const cw = aspect >= 1 ? SIZE : Math.round(SIZE * aspect);
    const chh = aspect >= 1 ? Math.round(SIZE / aspect) : SIZE;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== cw * dpr || canvas.height !== chh * dpr) {
      canvas.width = cw * dpr;
      canvas.height = chh * dpr;
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${chh}px`;
    }
    scale = cw / m.width;
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cw, chh);
    if (base) g.drawImage(base, 0, 0, cw, chh);
    // cities labels (dots)
    g.fillStyle = '#fff';
    g.font = '9px system-ui, sans-serif';
    g.textAlign = 'center';
    for (const c of Object.values(st.cities)) {
      const x = (c.x + 0.5) * scale;
      const y = (c.y + 0.5) * scale;
      g.beginPath();
      g.arc(x, y, 2, 0, Math.PI * 2);
      g.fill();
    }
    // viewport
    const cam = ctx.renderer.camera;
    const tl = cam.screenToTile(0, 0);
    const br = cam.screenToTile(cam.viewW, cam.viewH);
    g.strokeStyle = '#fff';
    g.lineWidth = 1.2;
    g.strokeRect(tl.x * scale, tl.y * scale, (br.x - tl.x) * scale, (br.y - tl.y) * scale);
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.strokeRect(tl.x * scale - 1, tl.y * scale - 1, (br.x - tl.x) * scale + 2, (br.y - tl.y) * scale + 2);
  };

  // interaction
  let dragging = false;
  const jump = (e: PointerEvent): void => {
    const st = ctx.tryState();
    if (!st) return;
    const r = canvas.getBoundingClientRect();
    const k = r.width / (canvas.clientWidth || r.width);
    const x = (e.clientX - r.left) / k / scale;
    const y = (e.clientY - r.top) / k / scale;
    ctx.renderer.camera.centerOnTile(Math.max(0, Math.min(st.map.width, x)), Math.max(0, Math.min(st.map.height, y)));
    redraw();
  };
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    jump(e);
  });
  canvas.addEventListener('pointermove', (e) => dragging && jump(e));
  canvas.addEventListener('pointerup', () => (dragging = false));
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const cam = ctx.renderer.camera;
    cam.zoomAt(Math.exp(-e.deltaY * 0.0015), cam.viewW / 2, cam.viewH / 2);
  });
  tooltip(canvas, () => {
    const st = ctx.tryState();
    return st ? `Minimapa ${st.map.width}×${st.map.height} — kliknij lub przeciągnij, aby przesunąć widok` : '';
  });

  let rafQueued = false;
  ctx.bus.on('camera:changed', () => {
    if (rafQueued) return;
    rafQueued = true;
    requestAnimationFrame(() => {
      rafQueued = false;
      redraw();
    });
  });
  ctx.bus.on('game:started', () => {
    base = null;
    dirtyTerrain = true;
    setTimeout(() => redraw(true), 0);
  });
  let terrainTimer: ReturnType<typeof setTimeout> | null = null;
  ctx.bus.on('map:changed', () => {
    if (terrainTimer) return;
    terrainTimer = setTimeout(() => {
      terrainTimer = null;
      dirtyTerrain = true;
    }, 800);
  });
  ctx.bus.on('overlay:changed', () => redraw(true));
  setInterval(() => redraw(), 1000);

  ctx.input.registerHotkey({ key: 'm', description: 'Minimapa pokaż/ukryj', handler: () => setVisible(!visible) });
  void TILE_SIZE;
}
