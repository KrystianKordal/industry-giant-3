/**
 * Vehicles layer (z=40): trucks / carts (right-hand traffic), multi-car trains
 * following their path, ships with wakes, drones/planes with shadows.
 * Positions interpolated between sim ticks (prevX → x with rc.alpha), heading
 * smoothed per vehicle. Far zoom: cargo-coloured dots.
 */
import { TILE_SIZE } from '../../core/constants';
import type { GameContext } from '../../core/context';
import type { Vehicle } from '../../core/types';
import type { VehicleDef } from '../../data/defs';
import { vehicleMainCargo } from '../../logistics/api';
import type { Effects } from '../effects';
import { PUBLIC_COLOR } from '../palette';
import type { LayerDef, RenderContext } from '../types';
import { shade } from '../util/color';
import { drawEmoji } from '../util/sprites';

const T = TILE_SIZE;

type VKind = 'cart' | 'truck' | 'semi' | 'van' | 'train' | 'ship' | 'barge' | 'drone' | 'plane';
const kindCache = new Map<string, VKind>();
function vkind(def: VehicleDef | undefined, v: Vehicle): VKind {
  const id = def?.id ?? v.typeId;
  let k = kindCache.get(id);
  if (k) return k;
  const s = id.toLowerCase();
  switch (v.mode) {
    case 'rail':
      k = 'train';
      break;
    case 'water':
      k = s.includes('barge') || s.includes('boat') ? 'barge' : 'ship';
      break;
    case 'air':
      k = s.includes('plane') || s.includes('cargo_air') || s.includes('jet') ? 'plane' : 'drone';
      break;
    default:
      k = s.includes('cart') || s.includes('horse') || s.includes('wagon') ? 'cart' : s.includes('van') || s.includes('electric_small') ? 'van' : (def?.capacity ?? 0) >= 40 ? 'semi' : 'truck';
  }
  kindCache.set(id, k);
  return k;
}

/** Walk back along a vehicle path from (px,py) by `dist` tiles; writes into out[0..1]. */
function pointBack(v: Vehicle, W: number, px: number, py: number, dist: number, out: Float32Array): void {
  let cx = px;
  let cy = py;
  let rem = dist;
  let k = Math.min(v.pathIndex, v.path.length - 1);
  while (rem > 0 && k >= 0 && v.path.length) {
    const i = v.path[k]!;
    const tx = (i % W) + 0.5;
    const ty = ((i / W) | 0) + 0.5;
    const d = Math.hypot(tx - cx, ty - cy);
    if (d >= rem) {
      cx += ((tx - cx) / d) * rem;
      cy += ((ty - cy) / d) * rem;
      rem = 0;
      break;
    }
    rem -= d;
    cx = tx;
    cy = ty;
    k--;
  }
  if (rem > 0) {
    // ran out of path — continue straight backwards along heading
    cx -= Math.cos(v.heading) * rem;
    cy -= Math.sin(v.heading) * rem;
  }
  out[0] = cx;
  out[1] = cy;
}

const angleLerp = (a: number, b: number, t: number): number => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

export function createVehiclesLayer(ctx: GameContext, fx: Effects): LayerDef {
  const headings = new Map<number, number>();
  const tmp = new Float32Array(2);
  const tmp2 = new Float32Array(2);
  ctx.bus.on('vehicle:sold', ({ vehicleId }) => headings.delete(vehicleId));
  ctx.bus.on('game:started', () => headings.clear());

  const cargoColor = (v: Vehicle): string | null => {
    const p = vehicleMainCargo(v);
    return p ? (ctx.data.products[p]?.color ?? '#c8a060') : null;
  };

  // --- shape drawers (local coords: +x = forward, centred) --------------
  const shadow = (g: CanvasRenderingContext2D, l: number, w: number, off: number): void => {
    g.fillStyle = 'rgba(20,24,30,0.3)';
    g.fillRect(-l / 2 + off * 0.4, -w / 2 + off, l, w);
  };

  const truck = (g: CanvasRenderingContext2D, body: string, owner: string, cargo: string | null, kind: VKind, detail: boolean): void => {
    const L = kind === 'semi' ? T * 0.78 : kind === 'van' ? T * 0.4 : T * 0.52;
    const Wd = T * 0.26;
    shadow(g, L, Wd, 2);
    const cab = kind === 'van' ? L * 0.4 : T * 0.16;
    // cargo box / bed
    g.fillStyle = cargo ?? '#9aa0a6';
    g.fillRect(-L / 2, -Wd / 2, L - cab - 1, Wd);
    if (detail) {
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(-L / 2, -Wd / 2, L - cab - 1, 1.2);
      g.strokeStyle = 'rgba(0,0,0,0.3)';
      g.lineWidth = 0.6;
      g.strokeRect(-L / 2, -Wd / 2, L - cab - 1, Wd);
    }
    // cab
    g.fillStyle = owner;
    g.fillRect(L / 2 - cab, -Wd / 2, cab, Wd);
    if (detail) {
      g.fillStyle = '#bfe0f0';
      g.fillRect(L / 2 - 2.6, -Wd / 2 + 1.2, 1.8, Wd - 2.4);
    }
    void body;
  };

  const cart = (g: CanvasRenderingContext2D, owner: string, cargo: string | null, t: number): void => {
    const L = T * 0.3;
    const Wd = T * 0.24;
    shadow(g, L + T * 0.26, Wd, 1.5);
    g.fillStyle = '#8a6440';
    g.fillRect(-L / 2 - 3, -Wd / 2, L, Wd);
    g.fillStyle = cargo ?? '#b09070';
    g.fillRect(-L / 2 - 2, -Wd / 2 + 1, L - 2, Wd - 2);
    g.fillStyle = '#3a2a1a';
    g.fillRect(-L / 2, -Wd / 2 - 1, 3, 1.4);
    g.fillRect(-L / 2, Wd / 2 - 0.4, 3, 1.4);
    // horse
    const bob = Math.sin(t * 10) * 0.4;
    g.fillStyle = '#6b4a30';
    g.beginPath();
    g.ellipse(L / 2 + 3, bob, 4, 1.8, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(L / 2 + 7, bob, 1.6, 1.1, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = owner;
    g.fillRect(-L / 2 - 3, -Wd / 2, 1.4, Wd);
  };

  const loco = (g: CanvasRenderingContext2D, def: VehicleDef | undefined, owner: string, detail: boolean): void => {
    const L = T * 0.72;
    const Wd = T * 0.34;
    shadow(g, L, Wd, 2.5);
    const steam = (def?.id ?? '').includes('steam') || (def?.era === 'industrial');
    const body = def?.color ?? '#303236';
    g.fillStyle = body;
    g.beginPath();
    if (g.roundRect) g.roundRect(-L / 2, -Wd / 2, L, Wd, steam ? 2 : 5);
    else g.rect(-L / 2, -Wd / 2, L, Wd);
    g.fill();
    g.fillStyle = owner;
    g.fillRect(-L / 2, -Wd / 2, L * 0.3, Wd);
    if (detail) {
      g.fillStyle = shade(body, 1.4);
      g.fillRect(-L / 2 + 1, -Wd / 2 + 1, L - 2, 1.4);
      if (steam) {
        g.fillStyle = '#1e1e20';
        g.beginPath();
        g.arc(L * 0.28, 0, 2.2, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = '#bfe0f0';
        g.fillRect(L / 2 - 3, -Wd / 2 + 1.5, 2, Wd - 3);
      }
    }
  };

  const wagon = (g: CanvasRenderingContext2D, cargo: string | null, owner: string, detail: boolean): void => {
    const L = T * 0.66;
    const Wd = T * 0.32;
    shadow(g, L, Wd, 2);
    g.fillStyle = '#4a4d54';
    g.fillRect(-L / 2, -Wd / 2, L, Wd);
    g.fillStyle = cargo ?? '#6f737a';
    g.fillRect(-L / 2 + 1.2, -Wd / 2 + 1.2, L - 2.4, Wd - 2.4);
    if (detail && cargo) {
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(-L / 2 + 1.2, -Wd / 2 + 1.2, L - 2.4, 1.2);
    }
    void owner;
  };

  const ship = (g: CanvasRenderingContext2D, owner: string, cargo: string | null, kind: VKind, t: number, moving: boolean, motion: boolean): void => {
    const L = kind === 'barge' ? T * 0.7 : T * 1.15;
    const Wd = kind === 'barge' ? T * 0.3 : T * 0.42;
    if (moving && motion) {
      // wake
      g.strokeStyle = 'rgba(240,250,255,0.55)';
      g.lineWidth = 1.2;
      const ph = (t * 1.5) % 1;
      g.beginPath();
      for (let i = 0; i < 3; i++) {
        const d = (i + ph) * T * 0.25;
        g.moveTo(-L / 2 - d, -Wd / 2 - d * 0.5);
        g.lineTo(-L / 2 + 2, 0);
        g.lineTo(-L / 2 - d, Wd / 2 + d * 0.5);
      }
      g.stroke();
    }
    g.fillStyle = 'rgba(10,30,50,0.3)';
    g.beginPath();
    g.moveTo(-L / 2 + 2, -Wd / 2 + 3);
    g.lineTo(L / 2 - Wd / 2 + 2, -Wd / 2 + 3);
    g.lineTo(L / 2 + 2, 3);
    g.lineTo(L / 2 - Wd / 2 + 2, Wd / 2 + 3);
    g.lineTo(-L / 2 + 2, Wd / 2 + 3);
    g.fill();
    g.fillStyle = owner;
    g.beginPath();
    g.moveTo(-L / 2, -Wd / 2);
    g.lineTo(L / 2 - Wd / 2, -Wd / 2);
    g.lineTo(L / 2, 0);
    g.lineTo(L / 2 - Wd / 2, Wd / 2);
    g.lineTo(-L / 2, Wd / 2);
    g.closePath();
    g.fill();
    g.fillStyle = '#e8e6e0';
    g.beginPath();
    g.moveTo(-L / 2 + 1.5, -Wd / 2 + 1.5);
    g.lineTo(L / 2 - Wd / 2, -Wd / 2 + 1.5);
    g.lineTo(L / 2 - 2, 0);
    g.lineTo(L / 2 - Wd / 2, Wd / 2 - 1.5);
    g.lineTo(-L / 2 + 1.5, Wd / 2 - 1.5);
    g.closePath();
    g.fill();
    // cargo blocks
    if (cargo) {
      g.fillStyle = cargo;
      const n = kind === 'barge' ? 2 : 4;
      for (let i = 0; i < n; i++) g.fillRect(-L / 2 + 5 + i * 6.2, -Wd / 2 + 3, 5.4, Wd - 6);
    }
    // bridge
    g.fillStyle = '#f7f7f2';
    g.fillRect(-L / 2 + 1.5, -Wd / 2 + 2.5, 4, Wd - 5);
  };

  const drone = (g: CanvasRenderingContext2D, owner: string, cargo: string | null, t: number, alt: number, kind: VKind): void => {
    // shadow on ground
    g.fillStyle = 'rgba(20,24,30,0.22)';
    g.beginPath();
    g.ellipse(alt, alt * 1.2, kind === 'plane' ? 10 : 5, kind === 'plane' ? 8 : 5, 0, 0, Math.PI * 2);
    g.fill();
    if (kind === 'plane') {
      g.fillStyle = '#eef0f2';
      g.fillRect(-9, -1.8, 18, 3.6);
      g.beginPath();
      g.moveTo(1, -10);
      g.lineTo(4, -10);
      g.lineTo(2, 0);
      g.lineTo(4, 10);
      g.lineTo(1, 10);
      g.lineTo(-2, 0);
      g.fill();
      g.fillStyle = owner;
      g.fillRect(-9, -1.8, 3, 3.6);
      return;
    }
    g.strokeStyle = '#3a3d44';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(-4, -4);
    g.lineTo(4, 4);
    g.moveTo(4, -4);
    g.lineTo(-4, 4);
    g.stroke();
    g.fillStyle = owner;
    g.fillRect(-2, -2, 4, 4);
    if (cargo) {
      g.fillStyle = cargo;
      g.fillRect(-1.3, -1.3, 2.6, 2.6);
    }
    g.fillStyle = 'rgba(200,210,220,0.55)';
    const r = 2.6 + Math.sin(t * 40) * 0.3;
    for (const [dx, dy] of ROTORS) {
      g.beginPath();
      g.arc(dx, dy, r, 0, Math.PI * 2);
      g.fill();
    }
  };

  const draw = (rc: RenderContext): void => {
    const { g, state, view, data } = rc;
    const W = state.map.width;
    const a = rc.alpha;
    const far = rc.detail === 'far';
    const detail = rc.ppt >= 24;
    const t = rc.timeMs / 1000;
    const turn = Math.min(1, (rc.dtMs / 1000) * 10);
    const z = rc.zoom;
    for (const key in state.vehicles) {
      const v = state.vehicles[key]!;
      const px = v.prevX + (v.x - v.prevX) * a;
      const py = v.prevY + (v.y - v.prevY) * a;
      if (px < view.x0 - 2 || py < view.y0 - 2 || px > view.x1 + 2 || py > view.y1 + 2) continue;
      if (v.status === 'depot' && v.path.length === 0 && !far) continue;
      const def = data.vehicles[v.typeId];
      const owner = state.companies[v.owner]?.color ?? PUBLIC_COLOR;
      const cargo = cargoColor(v);
      let hd = headings.get(v.id);
      const dx = v.x - v.prevX;
      const dy = v.y - v.prevY;
      const target = dx * dx + dy * dy > 1e-8 ? Math.atan2(dy, dx) : v.heading;
      hd = hd === undefined ? target : angleLerp(hd, target, turn);
      headings.set(v.id, hd);
      const kind = vkind(def, v);

      if (far) {
        const r = Math.max(1.8, 2.6 / z) * (kind === 'train' || kind === 'ship' ? 1.4 : 1);
        g.fillStyle = cargo ?? '#e8e8e8';
        g.beginPath();
        g.arc(px * T, py * T, r, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = owner;
        g.lineWidth = r * 0.45;
        g.stroke();
        continue;
      }

      if (kind === 'train') {
        const n = Math.max(1, v.wagons);
        // wagons first (behind the loco)
        for (let i = n; i >= 1; i--) {
          pointBack(v, W, px, py, i * 0.78, tmp);
          pointBack(v, W, px, py, i * 0.78 - 0.35, tmp2);
          const ang = Math.atan2(tmp2[1]! - tmp[1]!, tmp2[0]! - tmp[0]!);
          const wx = ((tmp[0]! + tmp2[0]!) / 2) * T;
          const wy = ((tmp[1]! + tmp2[1]!) / 2) * T;
          g.translate(wx, wy);
          g.rotate(ang);
          wagon(g, cargo, owner, detail);
          g.rotate(-ang);
          g.translate(-wx, -wy);
        }
        const lx = px * T;
        const ly = py * T;
        g.translate(lx, ly);
        g.rotate(hd);
        loco(g, def, owner, detail);
        g.rotate(-hd);
        g.translate(-lx, -ly);
        if (rc.motion && v.status === 'moving' && ((def?.id ?? '').includes('steam') || def?.era === 'industrial') && Math.random() < rc.dtMs / 120)
          fx.smoke(lx + Math.cos(hd) * T * 0.2, ly + Math.sin(hd) * T * 0.2, 0.8, false);
      } else {
        let wx = px * T;
        let wy = py * T;
        if (v.mode === 'road') {
          // drive on the right
          wx += -Math.sin(hd) * T * 0.14;
          wy += Math.cos(hd) * T * 0.14;
        }
        let alt = 0;
        if (v.mode === 'air') {
          alt = kind === 'plane' ? 10 : 5;
          wy -= alt * 0.3;
        }
        g.translate(wx, wy);
        g.rotate(hd);
        switch (kind) {
          case 'cart':
            cart(g, owner, cargo, rc.motion && v.status === 'moving' ? t : 0);
            break;
          case 'ship':
          case 'barge':
            ship(g, owner, cargo, kind, t, v.status === 'moving', rc.motion);
            break;
          case 'drone':
          case 'plane':
            drone(g, owner, cargo, t, alt, kind);
            break;
          default:
            truck(g, def?.color ?? '#888', owner, cargo, kind, detail);
        }
        g.rotate(-hd);
        g.translate(-wx, -wy);
      }

      // status markers
      if (v.status === 'broken' || v.status === 'noPath') {
        const s = Math.max(T * 0.35, 14 / z);
        const bob = rc.motion ? Math.sin(t * 4 + v.id) * 2 : 0;
        drawEmoji(g, v.status === 'broken' ? '🔧' : '❓', px * T, py * T - s * 0.8 + bob, s, s * z * rc.dpr);
      } else if (detail && rc.ppt >= 48 && cargo) {
        const p = vehicleMainCargo(v);
        const icon = p ? data.products[p]?.icon : undefined;
        if (icon) {
          const s = T * 0.28;
          drawEmoji(g, icon, px * T, py * T - T * 0.35, s, s * z * rc.dpr);
        }
      }
    }
  };

  return { id: 'vehicles', z: 40, draw };
}

const ROTORS: readonly (readonly [number, number])[] = [
  [-4, -4],
  [4, -4],
  [4, 4],
  [-4, 4],
];
