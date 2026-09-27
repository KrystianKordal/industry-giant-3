/**
 * Labels (z=70, screen space): city name + population pills with satisfaction
 * dot, sized by tier, de-overlapped (largest cities win). Route flow lines
 * (z=62, world) for the far zoom / traffic overlay. Grid & perf HUD.
 */
import { TILE_SIZE } from '../../core/constants';
import type { GameContext } from '../../core/context';
import { formatNumber } from '../../core/format';
import type { City, GameState } from '../../core/types';
import type { LayerDef, RenderContext } from '../types';
import { alpha } from '../util/color';

const T = TILE_SIZE;

const TIER_FONT: Record<City['tier'], number> = { village: 11, town: 12.5, city: 14, metropolis: 16 };

const popOf = (c: City): number => c.population.poor + c.population.middle + c.population.rich;

function fmtPop(n: number): string {
  if (n >= 1e6) return `${formatNumber(n / 1e6, 1)} mln`;
  if (n >= 1e4) return `${formatNumber(n / 1e3, 0)} tys.`;
  if (n >= 1e3) return `${formatNumber(n / 1e3, 1)} tys.`;
  return formatNumber(n);
}

export function createLabelLayers(ctx: GameContext): LayerDef[] {
  let sorted: City[] = [];
  let sortedAt = -1e9;
  let sortedFor: GameState | null = null;
  const rects = new Float32Array(4 * 256);

  const labels: LayerDef = {
    id: 'labels',
    z: 70,
    space: 'screen',
    draw(rc: RenderContext) {
      const { g, state } = rc;
      if (state !== sortedFor || rc.timeMs - sortedAt > 1000) {
        sortedFor = state;
        sortedAt = rc.timeMs;
        sorted = Object.values(state.cities).sort((a, b) => popOf(b) - popOf(a));
      }
      const cam = rc.camera;
      const z = cam.zoom;
      const hw = cam.viewW / 2;
      const hh = cam.viewH / 2;
      let nr = 0;
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      const far = rc.detail === 'far';
      for (const c of sorted) {
        const sx = ((c.x + 0.5) * T - cam.x) * z + hw;
        const syc = ((c.y + 0.5) * T - cam.y) * z + hh;
        // place label above the city footprint when close, centred when far
        const sy = far ? syc : syc - Math.min(140, (c.radius + 0.5) * T * z * 0.9);
        if (sx < -150 || sy < -40 || sx > rc.width + 150 || sy > rc.height + 40) continue;
        const pop = popOf(c);
        const fs = TIER_FONT[c.tier] ?? 12;
        if (far && c.tier === 'village' && rc.ppt < 6) continue;
        g.font = `700 ${fs}px system-ui, sans-serif`;
        const nameW = g.measureText(c.name).width;
        const popTxt = fmtPop(pop);
        g.font = `500 ${fs * 0.82}px system-ui, sans-serif`;
        const popW = g.measureText(popTxt).width;
        const padX = fs * 0.6;
        const dot = fs * 0.36;
        const w = padX + dot * 2 + fs * 0.35 + nameW + fs * 0.5 + popW + padX;
        const h = fs * 1.75;
        const x = sx - w / 2;
        const y = sy - h / 2;
        // overlap test
        let hit = false;
        for (let k = 0; k < nr; k++) {
          const o = k * 4;
          if (x < rects[o + 2]! && x + w > rects[o]! && y < rects[o + 3]! && y + h > rects[o + 1]!) {
            hit = true;
            break;
          }
        }
        if (hit) continue;
        if (nr < 256) {
          const o = nr * 4;
          rects[o] = x - 4;
          rects[o + 1] = y - 3;
          rects[o + 2] = x + w + 4;
          rects[o + 3] = y + h + 3;
          nr++;
        }
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.beginPath();
        if (g.roundRect) g.roundRect(x + 1, y + 2, w, h, h / 2);
        else g.rect(x + 1, y + 2, w, h);
        g.fill();
        g.fillStyle = 'rgba(16,20,30,0.82)';
        g.beginPath();
        if (g.roundRect) g.roundRect(x, y, w, h, h / 2);
        else g.rect(x, y, w, h);
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.14)';
        g.lineWidth = 1;
        g.stroke();
        // satisfaction dot
        const s = c.satisfaction;
        g.fillStyle = s >= 0.66 ? '#50c878' : s >= 0.4 ? '#e8d24a' : '#ff5a3c';
        g.beginPath();
        g.arc(x + padX + dot, sy, dot, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#f4f1ea';
        g.font = `700 ${fs}px system-ui, sans-serif`;
        g.fillText(c.name, x + padX + dot * 2 + fs * 0.35, sy + 0.5);
        g.fillStyle = 'rgba(230,226,215,0.7)';
        g.font = `500 ${fs * 0.82}px system-ui, sans-serif`;
        g.fillText(popTxt, x + padX + dot * 2 + fs * 0.35 + nameW + fs * 0.5, sy + 0.5);
      }
    },
  };

  // ------------------------------------------------------------ route flows
  const flows: LayerDef = {
    id: 'routes',
    z: 62,
    visible: (rc) => rc.detail === 'far' || rc.ctx.renderer.overlay === 'traffic',
    draw(rc) {
      const { g, state } = rc;
      const z = rc.zoom;
      const t = rc.motion ? rc.timeMs / 1000 : 0;
      g.lineCap = 'round';
      for (const id in state.routes) {
        const r = state.routes[id]!;
        if (!r.enabled || r.stops.length < 2) continue;
        const th = r.stats.throughputHistory;
        const thr = th.length ? th[th.length - 1]! : 0;
        const w = (2 + Math.min(6, Math.sqrt(thr) / 3)) / z;
        const n = r.stops.length;
        const loops = n === 2 ? 1 : n;
        for (let k = 0; k < loops; k++) {
          const a = state.buildings[r.stops[k]!.buildingId];
          const b = state.buildings[r.stops[(k + 1) % n]!.buildingId];
          if (!a || !b) continue;
          const ax = (a.x + a.w / 2) * T;
          const ay = (a.y + a.h / 2) * T;
          const bx = (b.x + b.w / 2) * T;
          const by = (b.y + b.h / 2) * T;
          const dx = bx - ax;
          const dy = by - ay;
          const len = Math.hypot(dx, dy) || 1;
          // bend to the right so opposite legs don't overlap
          const bend = n === 2 ? 0 : len * 0.12;
          const cx = (ax + bx) / 2 - (dy / len) * bend;
          const cy = (ay + by) / 2 + (dx / len) * bend;
          g.beginPath();
          g.moveTo(ax, ay);
          g.quadraticCurveTo(cx, cy, bx, by);
          g.strokeStyle = 'rgba(10,14,20,0.5)';
          g.lineWidth = w + 2 / z;
          g.setLineDash([]);
          g.stroke();
          g.strokeStyle = alpha(r.color, 0.95);
          g.lineWidth = w;
          g.setLineDash([w * 2.5, w * 2]);
          g.lineDashOffset = -t * 40 / z;
          g.stroke();
          if (n === 2) {
            // return direction: second dashed stroke going the other way
            g.lineDashOffset = t * 40 / z;
            g.strokeStyle = alpha(r.color, 0.45);
            g.stroke();
          }
        }
        // stop markers
        for (const s of r.stops) {
          const b = state.buildings[s.buildingId];
          if (!b) continue;
          g.setLineDash([]);
          g.fillStyle = '#fff';
          g.beginPath();
          g.arc((b.x + b.w / 2) * T, (b.y + b.h / 2) * T, w * 1.2, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = r.color;
          g.lineWidth = w * 0.6;
          g.stroke();
        }
      }
      g.setLineDash([]);
      g.lineDashOffset = 0;
      g.lineCap = 'butt';
    },
  };

  // ------------------------------------------------------------ grid & perf
  const grid: LayerDef = {
    id: 'grid',
    z: 65,
    visible: (rc) => rc.ctx.userSettings.showGrid && rc.ppt >= 12,
    draw({ g, view, zoom }) {
      g.strokeStyle = 'rgba(0,0,0,0.14)';
      g.lineWidth = 1 / zoom;
      g.beginPath();
      for (let x = view.x0; x <= view.x1; x++) {
        g.moveTo(x * T, view.y0 * T);
        g.lineTo(x * T, view.y1 * T);
      }
      for (let y = view.y0; y <= view.y1; y++) {
        g.moveTo(view.x0 * T, y * T);
        g.lineTo(view.x1 * T, y * T);
      }
      g.stroke();
    },
  };

  void ctx;
  return [labels, flows, grid];
}
