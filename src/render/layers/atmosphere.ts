/**
 * Atmosphere: cloud shadows (z=52), night tint (z=55, screen), night lights
 * (z=56, additive), weather precipitation/fog (z=57, screen), tilt-shift
 * (z=66, screen). Day/night follows sim time with a visual cycle of
 * DAY_NIGHT_CYCLE_DAYS game days (a real game day lasts ~1 s, too short).
 */
import { TILE_SIZE } from '../../core/constants';
import type { GameContext } from '../../core/context';
import type { GameState, WeatherKind } from '../../core/types';
import type { LayerDef, RenderContext } from '../types';
import { hashInt } from '../util/noise';
import { glowSprite, makeCanvas, puffSprite } from '../util/sprites';

const T = TILE_SIZE;
/** Visual day/night period in game days (1 cycle per game month). */
export const DAY_NIGHT_CYCLE_DAYS = 30;

const cycDist = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 1;
  return d > 0.5 ? 1 - d : d;
};

/** Darkness 0..1 and dusk warmth 0..1 for the current sim time. */
export function dayNight(state: GameState): { night: number; dusk: number } {
  const p = (((state.time.totalDays + state.time.dayFraction) % DAY_NIGHT_CYCLE_DAYS) + DAY_NIGHT_CYCLE_DAYS) % DAY_NIGHT_CYCLE_DAYS / DAY_NIGHT_CYCLE_DAYS;
  const d = cycDist(p, 0.9);
  const night = Math.max(0, Math.min(1, (0.12 - d) / 0.06));
  const dusk = Math.max(0, 1 - cycDist(p, 0.79) / 0.05) + Math.max(0, 1 - cycDist(p, 0.0) / 0.04) * 0.7;
  return { night, dusk: Math.min(1, dusk) };
}

/** Weather of the region under the camera centre. */
export function weatherAtCamera(rc: RenderContext): { kind: WeatherKind; wind: number } {
  const w = rc.state.weather;
  if (!w || !w.regions.length) return { kind: 'clear', wind: 0.3 };
  const tx = rc.camera.x / T;
  const ty = rc.camera.y / T;
  const ri = Math.min(w.rows - 1, Math.max(0, Math.floor(ty / w.regionSize))) * w.cols + Math.min(w.cols - 1, Math.max(0, Math.floor(tx / w.regionSize)));
  const r = w.regions[ri];
  return r ? { kind: r.kind, wind: r.wind } : { kind: 'clear', wind: 0.3 };
}

export function createAtmosphereLayers(ctx: GameContext): LayerDef[] {
  // ------------------------------------------------------------ clouds
  const cloudSpr = (): HTMLCanvasElement => puffSprite('rgba(18,26,40,1)');
  const clouds: LayerDef = {
    id: 'clouds',
    z: 52,
    visible: (rc) => rc.ppt < 64,
    draw(rc) {
      const { g, state } = rc;
      const { kind, wind } = weatherAtCamera(rc);
      const base = kind === 'clear' || kind === 'heat' ? 0.05 : kind === 'cloudy' || kind === 'fog' ? 0.11 : 0.14;
      const W = state.map.width * T;
      const H = state.map.height * T;
      const spr = cloudSpr();
      const t = rc.motion ? rc.timeMs / 1000 : 0;
      const n = Math.max(6, Math.round((state.map.width * state.map.height) / 900));
      const v = rc.view;
      for (let i = 0; i < n; i++) {
        const h = hashInt(i, 17, state.map.seed);
        const r = (6 + (h & 15)) * T;
        const x = ((((h >>> 4) & 1023) / 1023) * (W + r * 2) + t * (6 + wind * 18)) % (W + r * 2) - r;
        const y = (((h >>> 14) & 1023) / 1023) * H + Math.sin(t * 0.02 + i) * T;
        if (x + r < v.x0 * T || x - r > v.x1 * T || y + r < v.y0 * T || y - r > v.y1 * T) continue;
        g.globalAlpha = base * (0.7 + ((h >>> 24) & 7) / 20);
        g.drawImage(spr, x - r, y - r * 0.7, r * 2, r * 1.4);
        g.drawImage(spr, x - r * 0.3, y - r * 0.9, r * 1.4, r * 1.2);
      }
      g.globalAlpha = 1;
    },
  };

  // ------------------------------------------------------------ night tint
  const tint: LayerDef = {
    id: 'night',
    z: 55,
    space: 'screen',
    visible: (rc) => rc.ctx.userSettings.dayNightCycle,
    draw(rc) {
      const { g } = rc;
      const { night, dusk } = dayNight(rc.state);
      const { kind } = weatherAtCamera(rc);
      const gloom = kind === 'storm' ? 0.35 : kind === 'rain' ? 0.18 : kind === 'fog' || kind === 'cloudy' ? 0.08 : 0;
      if (night < 0.01 && dusk < 0.01 && gloom < 0.01) return;
      // multiply colour: white → night blue, warm at dusk, grey in storms
      let r = 255;
      let gg = 255;
      let b = 255;
      const nk = night * (rc.ctx.renderer.overlay ? 0.35 : 0.56); // keep the map readable at night (esp. with overlays)
      r += (60 - r) * nk;
      gg += (80 - gg) * nk;
      b += (150 - b) * nk;
      const dk = dusk * (1 - night) * 0.35;
      gg += (190 - gg) * dk;
      b += (150 - b) * dk;
      r -= r * gloom * 0.5;
      gg -= gg * gloom * 0.45;
      b -= b * gloom * 0.35;
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
      g.fillRect(0, 0, rc.width, rc.height);
      g.globalCompositeOperation = 'source-over';
    },
  };

  // ------------------------------------------------------------ night lights
  const lights: LayerDef = {
    id: 'lights',
    z: 56,
    visible: (rc) => rc.night > 0.04,
    draw(rc) {
      const { g, state, view } = rc;
      const k = rc.night;
      const warm = glowSprite('rgba(255,205,130,1)');
      const cool = glowSprite('rgba(210,230,255,1)');
      g.globalCompositeOperation = 'lighter';
      if (rc.detail === 'far') {
        for (const id in state.cities) {
          const c = state.cities[id]!;
          const r = (c.radius + 2) * T * 1.4;
          g.globalAlpha = k * 0.55;
          g.drawImage(warm, (c.x + 0.5) * T - r, (c.y + 0.5) * T - r, r * 2, r * 2);
        }
      } else {
        const { house, width: W } = state.map;
        const road = state.network.road;
        g.globalAlpha = k * 0.7;
        const t = rc.timeMs / 1000;
        for (let y = view.y0; y < view.y1; y++)
          for (let x = view.x0; x < view.x1; x++) {
            const i = y * W + x;
            const lv = house[i]!;
            if (lv) {
              const h = hashInt(x, y, 31);
              const n = lv >= 4 ? 3 : 1 + (h & 1);
              for (let j = 0; j < n; j++) {
                const hj = h >>> (j * 7);
                if (rc.motion && ((hj >>> 3) & 15) === 0 && Math.sin(t * 0.3 + j + x) > 0.6) continue; // some lights off
                const px = (x + 0.2 + ((hj & 63) / 63) * 0.6) * T;
                const py = (y + 0.2 + (((hj >>> 6) & 63) / 63) * 0.6) * T;
                const s = T * (lv >= 4 ? 0.34 : 0.26);
                g.drawImage(warm, px - s / 2, py - s / 2, s, s);
              }
            } else if (road[i]! >= 2 && (x + y) % 3 === 0) {
              const s = T * 0.55;
              g.drawImage(cool, (x + 0.5) * T - s / 2, (y + 0.5) * T - s / 2, s, s);
            }
          }
        // working buildings glow
        g.globalAlpha = k * 0.35;
        for (const id in state.buildings) {
          const b = state.buildings[id]!;
          if (b.x + b.w < view.x0 || b.y + b.h < view.y0 || b.x > view.x1 || b.y > view.y1) continue;
          if (b.status !== 'ok' || b.constructionProgress < 1) continue;
          const r = Math.min(b.w, b.h) * T * 0.4;
          g.drawImage(warm, (b.x + b.w / 2) * T - r, (b.y + b.h / 2) * T - r, r * 2, r * 2);
        }
        // headlights
        g.globalAlpha = k * 0.8;
        const a = rc.alpha;
        for (const id in state.vehicles) {
          const v = state.vehicles[id]!;
          if (v.mode === 'water') continue;
          const px = (v.prevX + (v.x - v.prevX) * a) * T;
          const py = (v.prevY + (v.y - v.prevY) * a) * T;
          if (px < view.x0 * T || py < view.y0 * T || px > view.x1 * T || py > view.y1 * T) continue;
          const s = T * 0.5;
          g.drawImage(cool, px + Math.cos(v.heading) * T * 0.35 - s / 2, py + Math.sin(v.heading) * T * 0.35 - s / 2, s, s);
        }
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    },
  };

  // ------------------------------------------------------------ precipitation / fog
  const N = 260;
  const px = new Float32Array(N);
  const py = new Float32Array(N);
  const pz = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    px[i] = Math.random();
    py[i] = Math.random();
    pz[i] = 0.5 + Math.random() * 0.5;
  }
  let flash = 0;
  const weather: LayerDef = {
    id: 'weather',
    z: 57,
    space: 'screen',
    visible: (rc) => rc.motion,
    draw(rc) {
      const { g, width, height } = rc;
      const { kind, wind } = weatherAtCamera(rc);
      const dt = Math.min(0.1, rc.dtMs / 1000);
      if (kind === 'fog') {
        const grd = g.createLinearGradient(0, 0, 0, height);
        grd.addColorStop(0, 'rgba(225,230,235,0.2)');
        grd.addColorStop(0.5, 'rgba(225,230,235,0.06)');
        grd.addColorStop(1, 'rgba(225,230,235,0.18)');
        g.fillStyle = grd;
        g.fillRect(0, 0, width, height);
        return;
      }
      const rain = kind === 'rain' || kind === 'storm';
      const snow = kind === 'snow';
      if (!rain && !snow) return;
      const n = kind === 'storm' ? N : rain ? 170 : 150;
      const zk = Math.min(1, 0.4 + rc.zoom * 0.4);
      if (rain) {
        g.strokeStyle = 'rgba(200,215,235,0.35)';
        g.lineWidth = 1;
        g.beginPath();
        const sx = (0.15 + wind * 0.5) * 0.06;
        for (let i = 0; i < n; i++) {
          py[i] += dt * 1.6 * pz[i]!;
          px[i] += dt * sx * 8 * pz[i]!;
          if (py[i]! > 1) {
            py[i] = 0;
            px[i] = Math.random();
          }
          if (px[i]! > 1) px[i] -= 1;
          const x = px[i]! * width;
          const y = py[i]! * height;
          const l = 14 * pz[i]! * zk;
          g.moveTo(x, y);
          g.lineTo(x + l * sx * 6, y + l);
        }
        g.stroke();
        if (kind === 'storm') {
          if (flash <= 0 && Math.random() < dt * 0.12) flash = 1;
          if (flash > 0) {
            g.fillStyle = `rgba(235,240,255,${(flash * 0.35).toFixed(3)})`;
            g.fillRect(0, 0, width, height);
            flash -= dt * 4;
          }
        }
      } else {
        g.fillStyle = 'rgba(250,252,255,0.85)';
        for (let i = 0; i < n; i++) {
          py[i] += dt * 0.12 * pz[i]!;
          px[i] += dt * (0.02 * Math.sin(rc.timeMs / 900 + i) + wind * 0.03);
          if (py[i]! > 1) {
            py[i] = 0;
            px[i] = Math.random();
          }
          if (px[i]! > 1) px[i] -= 1;
          if (px[i]! < 0) px[i] += 1;
          const r = 1.6 * pz[i]! * zk;
          g.fillRect(px[i]! * width - r / 2, py[i]! * height - r / 2, r, r);
        }
      }
    },
  };

  // ------------------------------------------------------------ tilt-shift
  let scratch: HTMLCanvasElement | null = null;
  const filterOk = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;
  const tilt: LayerDef = {
    id: 'tiltshift',
    z: 66,
    space: 'screen',
    visible: (rc) => rc.ctx.userSettings.tiltShift && filterOk,
    draw(rc) {
      const main = rc.g.canvas;
      const w = Math.max(1, Math.round(main.width / 2));
      const h = Math.max(1, Math.round(main.height / 2));
      if (!scratch || scratch.width !== w || scratch.height !== h) scratch = makeCanvas(w, h);
      const sg = scratch.getContext('2d')!;
      sg.globalCompositeOperation = 'source-over';
      sg.clearRect(0, 0, w, h);
      sg.filter = 'blur(3px) saturate(1.15)';
      sg.drawImage(main, 0, 0, w, h);
      sg.filter = 'none';
      const m = sg.createLinearGradient(0, 0, 0, h);
      m.addColorStop(0, 'rgba(0,0,0,1)');
      m.addColorStop(0.3, 'rgba(0,0,0,0)');
      m.addColorStop(0.68, 'rgba(0,0,0,0)');
      m.addColorStop(1, 'rgba(0,0,0,1)');
      sg.globalCompositeOperation = 'destination-in';
      sg.fillStyle = m;
      sg.fillRect(0, 0, w, h);
      sg.globalCompositeOperation = 'source-over';
      const g = rc.g;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.imageSmoothingEnabled = true;
      g.drawImage(scratch, 0, 0, main.width, main.height);
    },
  };

  void ctx;
  return [clouds, tint, lights, weather, tilt];
}
