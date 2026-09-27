/**
 * Procedural building art (top-down, NW light, SE shadows). One drawer per
 * visual archetype, chosen from BuildingDef (category, id keywords, station
 * mode, products). All coordinates in world px (tile = TILE_SIZE).
 */
import { TILE_SIZE } from '../../core/constants';
import type { BuildingDef } from '../../data/defs';
import type { DataRegistry as Registry } from '../../data/registry';
import { alpha, mix, shade } from '../util/color';
import { hashInt } from '../util/noise';

const T = TILE_SIZE;

export type ArtKind =
  | 'farm'
  | 'ranch'
  | 'orchard'
  | 'mine'
  | 'quarry'
  | 'lumber'
  | 'oil'
  | 'fishery'
  | 'factory'
  | 'shop'
  | 'warehouse'
  | 'depot'
  | 'railStation'
  | 'harbor'
  | 'airport'
  | 'lab'
  | 'recycling'
  | 'wind'
  | 'solar'
  | 'powerplant'
  | 'hydro'
  | 'export'
  | 'hq'
  | 'datacenter'
  | 'generic';

const kindCache = new Map<string, ArtKind>();
const has = (s: string, ...k: string[]): boolean => k.some((w) => s.includes(w));

/** Visual archetype for a def (cached per id). */
export function artKindOf(def: BuildingDef, data: Registry): ArtKind {
  let k = kindCache.get(def.id);
  if (k) return k;
  const id = def.id.toLowerCase();
  const outs: string[] = [];
  for (const r of def.recipes) {
    const rec = data.recipes[r];
    if (rec) for (const o of rec.outputs) outs.push(o.product);
  }
  const outCat = outs.map((p) => data.products[p]?.category ?? '');
  switch (def.category) {
    case 'raw':
      if (has(id, 'fish')) k = 'fishery';
      else if (has(id, 'oil', 'well', 'pump', 'gas', 'derrick')) k = 'oil';
      else if (has(id, 'lumber', 'forest', 'wood', 'timber', 'saw', 'logging')) k = 'lumber';
      else if (has(id, 'quarry', 'sand', 'clay', 'stone')) k = 'quarry';
      else if (def.requiresDeposit || has(id, 'mine')) k = 'mine';
      else if (has(id, 'cattle', 'cow', 'ranch', 'pig', 'sheep', 'wool', 'milk', 'dairy', 'chicken', 'poultry', 'egg', 'livestock')) k = 'ranch';
      else if (has(id, 'orchard', 'fruit', 'vineyard', 'grape', 'plantation', 'cocoa', 'coffee', 'tea', 'rubber')) k = 'orchard';
      else if (def.minFertility !== undefined || has(id, 'farm', 'field') || outCat.includes('agri')) k = 'farm';
      else k = 'mine';
      break;
    case 'factory':
      k = has(id, 'data_center', 'datacenter', 'software', 'server_farm') ? 'datacenter' : 'factory';
      break;
    case 'shop':
      k = 'shop';
      break;
    case 'warehouse':
      k = 'warehouse';
      break;
    case 'station':
      k =
        def.stationMode === 'rail' || has(id, 'rail', 'train')
          ? 'railStation'
          : def.stationMode === 'water' || has(id, 'port', 'harbor', 'harbour', 'dock', 'pier')
            ? 'harbor'
            : def.stationMode === 'air' || has(id, 'air', 'drone', 'heli')
              ? 'airport'
              : 'depot';
      break;
    case 'research':
      k = has(id, 'data', 'server') ? 'datacenter' : 'lab';
      break;
    case 'recycling':
      k = 'recycling';
      break;
    case 'energy':
      k = has(id, 'wind') ? 'wind' : has(id, 'solar', 'pv') ? 'solar' : has(id, 'hydro', 'dam') ? 'hydro' : 'powerplant';
      break;
    case 'export':
      k = def.requiresWater || has(id, 'port') ? 'harbor' : 'export';
      break;
    case 'hq':
      k = 'hq';
      break;
    default:
      k = 'generic';
  }
  kindCache.set(def.id, k);
  return k;
}

export interface ArtBuilding {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  progress: number;
}

export interface ArtOptions {
  /** Seconds (animation clock). */
  t: number;
  working: boolean;
  /** CSS px per tile — detail decisions. */
  ppt: number;
  ownerColor: string;
  /** Main output product colour (fields, cargo, heaps). */
  productColor: string;
  animate: boolean;
  /** Smoke/steam emitter (world px); omitted for ghosts. */
  emit?: (kind: 'smoke' | 'dark' | 'steam', wx: number, wy: number, rate: number) => void;
  /** Emission intensity 0..1+ (from def.pollution). */
  pollution: number;
}

// ------------------------------------------------------------------ primitives

function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
}

/** Box with drop shadow, lit NW edges. height in px affects shadow length. */
export function box(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, roof: string, height: number, detail: boolean): void {
  g.fillStyle = 'rgba(25,28,36,0.28)';
  g.beginPath();
  g.moveTo(x + w, y);
  g.lineTo(x + w + height, y + height * 1.1);
  g.lineTo(x + w + height, y + h + height * 1.1);
  g.lineTo(x + height, y + h + height * 1.1);
  g.lineTo(x, y + h);
  g.closePath();
  g.fill();
  g.fillStyle = roof;
  g.fillRect(x, y, w, h);
  if (!detail) return;
  g.fillStyle = shade(roof, 1.2);
  g.fillRect(x, y, w, 1.2);
  g.fillRect(x, y, 1.2, h);
  g.fillStyle = shade(roof, 0.72);
  g.fillRect(x, y + h - 1.2, w, 1.2);
  g.fillRect(x + w - 1.2, y, 1.2, h);
}

function gableRoof(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, roof: string, alongX: boolean, height: number): void {
  g.fillStyle = 'rgba(25,28,36,0.28)';
  g.fillRect(x + height, y + height * 1.1, w, h);
  g.fillStyle = shade(roof, 1.08);
  g.fillRect(x, y, w, h);
  g.fillStyle = shade(roof, 0.78);
  if (alongX) g.fillRect(x, y + h / 2, w, h / 2);
  else g.fillRect(x + w / 2, y, w / 2, h);
  g.fillStyle = shade(roof, 1.3);
  if (alongX) g.fillRect(x + 1, y + h / 2 - 0.6, w - 2, 1.2);
  else g.fillRect(x + w / 2 - 0.6, y + 1, 1.2, h - 2);
}

function chimney(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, o: ArtOptions, dark: boolean): void {
  g.fillStyle = 'rgba(25,28,36,0.3)';
  g.beginPath();
  g.ellipse(cx + r * 2.2, cy + r * 2.4, r * 1.1, r, 0.8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#8b5a48';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3b3230';
  g.beginPath();
  g.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#d8d0c8';
  g.lineWidth = r * 0.25;
  g.beginPath();
  g.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
  g.stroke();
  if (o.working && o.emit && o.pollution > 0) o.emit(dark ? 'dark' : 'smoke', cx, cy, 0.8 + o.pollution * 0.25);
}

function pad(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, ppt: number): void {
  rrect(g, x + 1, y + 1, w - 2, h - 2, 3);
  g.fillStyle = color;
  g.fill();
  if (ppt >= 18) {
    g.strokeStyle = shade(color, 0.8);
    g.lineWidth = 1;
    g.stroke();
  }
}

function crates(g: CanvasRenderingContext2D, x: number, y: number, n: number, seed: number, colors: string[]): void {
  for (let i = 0; i < n; i++) {
    const h = hashInt(seed, i, 3);
    const c = colors[h % colors.length]!;
    const cx = x + (i % 3) * 5.2;
    const cy = y + ((i / 3) | 0) * 5.2;
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(cx + 1, cy + 1.2, 4.4, 4.4);
    g.fillStyle = c;
    g.fillRect(cx, cy, 4.4, 4.4);
    g.fillStyle = shade(c, 1.25);
    g.fillRect(cx, cy, 4.4, 1);
  }
}

// ------------------------------------------------------------------ drawers

type Drawer = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, b: ArtBuilding, def: BuildingDef, o: ArtOptions) => void;

const farm: Drawer = (g, x, y, w, h, b, def, o) => {
  // field growth: ploughed → green → product colour
  const p = Math.max(0, Math.min(1, b.progress));
  const ground = p < 0.45 ? mix('#8e6c4a', '#79b25a', p / 0.45) : mix('#79b25a', o.productColor, (p - 0.45) / 0.55);
  rrect(g, x + 1, y + 1, w - 2, h - 2, 2);
  g.fillStyle = ground;
  g.fill();
  if (o.ppt >= 12) {
    const along = (b.rotation & 1) === 0;
    g.strokeStyle = shade(ground, 0.8);
    g.lineWidth = 1.2;
    g.beginPath();
    const step = 3.2;
    if (along) for (let yy = y + 3; yy < y + h - 2; yy += step) {
      g.moveTo(x + 2, yy);
      g.lineTo(x + w - 2, yy);
    }
    else for (let xx = x + 3; xx < x + w - 2; xx += step) {
      g.moveTo(xx, y + 2);
      g.lineTo(xx, y + h - 2);
    }
    g.stroke();
  }
  // farmyard corner
  const corner = b.rotation;
  const bx = corner === 1 || corner === 2 ? x + w - T * 1.05 : x + 2;
  const by = corner >= 2 ? y + 2 : y + h - T * 1.05;
  g.fillStyle = '#c9b690';
  g.fillRect(bx, by, T * 1.03, T * 1.03);
  gableRoof(g, bx + 3, by + 4, T * 0.62, T * 0.44, '#b8483a', true, 3);
  // silo
  g.fillStyle = 'rgba(25,28,36,0.3)';
  g.beginPath();
  g.arc(bx + T * 0.82 + 3, by + T * 0.72 + 3.5, T * 0.15, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#b8bcc2';
  g.beginPath();
  g.arc(bx + T * 0.82, by + T * 0.72, T * 0.15, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#dfe2e6';
  g.beginPath();
  g.arc(bx + T * 0.79, by + T * 0.69, T * 0.07, 0, Math.PI * 2);
  g.fill();
  // tractor crawling over the field when working
  if (o.working && o.ppt >= 20 && o.animate) {
    const u = (o.t * 0.07 + b.id * 0.13) % 1;
    const tx = x + 6 + u * (w - 12);
    const ty = y + 6 + ((Math.floor(o.t * 0.07 + b.id * 0.13) % 3) / 3) * (h - 20);
    g.fillStyle = '#d0452f';
    g.fillRect(tx - 2.5, ty - 1.8, 5, 3.6);
    g.fillStyle = '#222';
    g.fillRect(tx - 3, ty + 1.6, 2, 1.2);
    g.fillRect(tx + 1, ty + 1.6, 2, 1.2);
  }
};

const ranch: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#8fbf66', o.ppt);
  g.strokeStyle = '#8a6a44';
  g.lineWidth = 1;
  g.setLineDash([3, 2]);
  g.strokeRect(x + 3, y + 3, w - 6, h - 6);
  g.setLineDash([]);
  gableRoof(g, x + 5, y + 5, T * 0.8, T * 0.5, '#a8543e', true, 3);
  // animals
  const n = Math.max(3, Math.round((w * h) / (T * T)) * 2);
  const isDark = def.id.includes('pig') ? '#e6a8a0' : def.id.includes('sheep') || def.id.includes('wool') ? '#f2efe6' : '#6b4a36';
  for (let i = 0; i < n; i++) {
    const hh = hashInt(b.id, i, 11);
    const ax = x + 8 + ((hh & 255) / 255) * (w - 16) + (o.animate ? Math.sin(o.t * 0.4 + i) * 2 : 0);
    const ay = y + T * 0.7 + (((hh >> 8) & 255) / 255) * (h - T * 0.7 - 8);
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.beginPath();
    g.ellipse(ax + 1, ay + 1.2, 2.6, 1.7, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = (hh >> 16) & 1 ? isDark : '#f0ece4';
    g.beginPath();
    g.ellipse(ax, ay, 2.6, 1.7, 0, 0, Math.PI * 2);
    g.fill();
  }
};

const orchard: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#a3c070', o.ppt);
  for (let yy = y + 6; yy < y + h - 4; yy += 7)
    for (let xx = x + 6; xx < x + w - 4; xx += 7) {
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.beginPath();
      g.arc(xx + 1, yy + 1.4, 2.8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#4f8f45';
      g.beginPath();
      g.arc(xx, yy, 2.8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = o.productColor;
      g.beginPath();
      g.arc(xx - 0.8, yy - 0.8, 0.9, 0, Math.PI * 2);
      g.fill();
    }
};

const mine: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#7a7166', o.ppt);
  // spoil heap
  const hx = x + w * 0.7;
  const hy = y + h * 0.68;
  const hr = Math.min(w, h) * 0.26;
  const grd = g.createRadialGradient(hx - hr * 0.3, hy - hr * 0.3, hr * 0.1, hx, hy, hr);
  grd.addColorStop(0, shade(o.productColor, 1.35));
  grd.addColorStop(1, shade(o.productColor, 0.7));
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.beginPath();
  g.arc(hx + 2, hy + 2.5, hr, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = grd;
  g.beginPath();
  g.arc(hx, hy, hr, 0, Math.PI * 2);
  g.fill();
  // shed
  box(g, x + 4, y + h * 0.55, w * 0.34, h * 0.36, '#9b8f82', 3, o.ppt >= 16);
  // headframe
  const fx = x + w * 0.3;
  const fy = y + h * 0.3;
  const s = Math.min(w, h) * 0.2;
  g.strokeStyle = '#3d3a38';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(fx - s, fy + s);
  g.lineTo(fx, fy - s * 0.6);
  g.lineTo(fx + s, fy + s);
  g.moveTo(fx - s * 0.6, fy + s * 0.4);
  g.lineTo(fx + s * 0.6, fy + s * 0.4);
  g.stroke();
  const a = o.working && o.animate ? o.t * 3 : 0;
  g.lineWidth = 1.2;
  g.beginPath();
  g.arc(fx, fy - s * 0.6, s * 0.45, 0, Math.PI * 2);
  for (let i = 0; i < 4; i++) {
    const aa = a + (i * Math.PI) / 2;
    g.moveTo(fx, fy - s * 0.6);
    g.lineTo(fx + Math.cos(aa) * s * 0.45, fy - s * 0.6 + Math.sin(aa) * s * 0.45);
  }
  g.stroke();
  // cart track
  g.strokeStyle = '#5a4a3c';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(fx + s, fy + s);
  g.lineTo(hx - hr * 0.5, hy);
  g.stroke();
  if (o.working && o.animate && o.ppt >= 20) {
    const u = (Math.sin(o.t * 0.8 + b.id) + 1) / 2;
    const cx = fx + s + (hx - hr * 0.5 - fx - s) * u;
    const cy = fy + s + (hy - fy - s) * u;
    g.fillStyle = '#4a4440';
    g.fillRect(cx - 2, cy - 1.5, 4, 3);
    g.fillStyle = o.productColor;
    g.fillRect(cx - 1.5, cy - 1.5, 3, 1.3);
  }
};

const quarry: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#b9ab95', o.ppt);
  for (let i = 0; i < 3; i++) {
    rrect(g, x + 4 + i * 3, y + 4 + i * 3, w - 8 - i * 6, h - 8 - i * 6, 3);
    g.fillStyle = shade('#b3a38a', 1 - i * 0.08);
    g.fill();
  }
  box(g, x + 3, y + 3, T * 0.4, T * 0.3, '#8f8a84', 2, o.ppt >= 16);
};

const lumber: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#a8946c', o.ppt);
  gableRoof(g, x + 4, y + 4, w * 0.5, h * 0.36, '#7d5a3c', true, 3);
  // log piles
  for (let p = 0; p < 3; p++) {
    const lx = x + 5 + p * (w * 0.3);
    const ly = y + h * 0.58;
    for (let i = 0; i < 4; i++) {
      g.fillStyle = '#8a5a34';
      g.fillRect(lx, ly + i * 2.6, w * 0.24, 2.2);
      g.fillStyle = '#d9b27a';
      g.beginPath();
      g.arc(lx, ly + i * 2.6 + 1.1, 1.1, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (o.working && o.emit && o.ppt >= 16 && Math.random() < 0.05) o.emit('steam', x + w * 0.3, y + h * 0.3, 0.3);
};

const oil: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#c7b48d', o.ppt);
  // tanks
  const r = Math.min(w, h) * 0.16;
  for (let i = 0; i < 2; i++) {
    const cx = x + w * 0.72;
    const cy = y + h * (0.3 + i * 0.4);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.arc(cx + 2, cy + 2.5, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#d9dcdf';
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#9aa0a6';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(cx, cy, r * 0.65, 0, Math.PI * 2);
    g.stroke();
  }
  // pumpjack
  const px = x + w * 0.3;
  const py = y + h * 0.5;
  const ang = o.working && o.animate ? Math.sin(o.t * 2.2 + b.id) * 0.35 : 0;
  const L = Math.min(w, h) * 0.3;
  g.fillStyle = '#3a3a3f';
  g.fillRect(px - 2, py - 2, 4, 6);
  g.strokeStyle = '#e0a030';
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(px - Math.cos(ang) * L, py - Math.sin(ang) * L * 0.4);
  g.lineTo(px + Math.cos(ang) * L, py + Math.sin(ang) * L * 0.4);
  g.stroke();
  g.fillStyle = '#e0a030';
  g.beginPath();
  g.arc(px + Math.cos(ang) * L, py + Math.sin(ang) * L * 0.4, 2.6, 0, Math.PI * 2);
  g.fill();
};

const fishery: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#b9ad96', o.ppt);
  gableRoof(g, x + 3, y + 3, w * 0.6, h * 0.45, '#4f7fa0', true, 3);
  g.fillStyle = '#8a6a44';
  g.fillRect(x + w * 0.66, y + h * 0.3, w * 0.28, 3);
  // boat
  g.fillStyle = '#f2f0ea';
  g.beginPath();
  g.ellipse(x + w * 0.78, y + h * 0.7, 5, 2.4, 0, 0, Math.PI * 2);
  g.fill();
};

const factory: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#bdb6a8', o.ppt);
  const detail = o.ppt >= 16;
  const base = def.color ?? '#9a8f84';
  const roof = mix(base, '#8d9096', 0.45);
  // main hall with sawtooth roof
  const hx = x + 3;
  const hy = y + 3;
  const hw = w * 0.68;
  const hh = h - 10;
  box(g, hx, hy, hw, hh, roof, 5, detail);
  if (detail) {
    const along = hw >= hh;
    g.fillStyle = shade(roof, 0.78);
    const step = 5;
    if (along) for (let xx = hx + 3; xx < hx + hw - 2; xx += step) g.fillRect(xx, hy + 1.5, 2, hh - 3);
    else for (let yy = hy + 3; yy < hy + hh - 2; yy += step) g.fillRect(hx + 1.5, yy, hw - 3, 2);
    g.fillStyle = alpha('#bfe3f5', 0.55);
    if (along) for (let xx = hx + 5; xx < hx + hw - 2; xx += step) g.fillRect(xx, hy + 1.5, 0.8, hh - 3);
    else for (let yy = hy + 5; yy < hy + hh - 2; yy += step) g.fillRect(hx + 1.5, yy, hw - 3, 0.8);
  }
  // annex (office) in owner colour accent
  const ax = x + w * 0.72;
  const ay = y + 4;
  box(g, ax, ay, w * 0.24, h * 0.36, '#d8d2c6', 3, detail);
  g.fillStyle = o.ownerColor;
  g.fillRect(ax, ay, w * 0.24, 2.2);
  // loading docks
  g.fillStyle = '#4a4e56';
  for (let i = 0; i < 3; i++) g.fillRect(hx + 4 + i * 7, hy + hh - 1, 5, 2.5);
  // chimneys
  const n = def.pollution >= 4 ? 2 : def.pollution > 0 ? 1 : 0;
  for (let i = 0; i < n; i++) chimney(g, x + w * 0.82 + i * -7, y + h * 0.66 + i * 4, Math.max(2.4, T * 0.09), o, def.pollution >= 6);
  // spinning roof vent
  if (detail && o.ppt >= 24) {
    const vx = hx + hw * 0.5;
    const vy = hy + hh * 0.5;
    g.fillStyle = '#6b6f76';
    g.beginPath();
    g.arc(vx, vy, 3.4, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#c9ccd2';
    g.lineWidth = 1;
    const a = o.working && o.animate ? o.t * 6 : 0;
    g.beginPath();
    for (let i = 0; i < 3; i++) {
      g.moveTo(vx, vy);
      g.lineTo(vx + Math.cos(a + (i * 2 * Math.PI) / 3) * 3, vy + Math.sin(a + (i * 2 * Math.PI) / 3) * 3);
    }
    g.stroke();
  }
};

const datacenter: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#c4c8cc', o.ppt);
  box(g, x + 3, y + 3, w - 6, h - 6, '#e8ebee', 4, true);
  g.fillStyle = '#9aa3ad';
  for (let yy = y + 7; yy < y + h - 6; yy += 5)
    for (let xx = x + 7; xx < x + w - 6; xx += 6) g.fillRect(xx, yy, 4, 2.5);
  if (o.working && o.animate) {
    g.fillStyle = (Math.floor(o.t * 3 + b.id) & 1) ? '#4ae08a' : '#2a9a5a';
    g.fillRect(x + w - 8, y + 5, 2, 2);
  }
};

const shop: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#ddd6c8', o.ppt);
  const roof = def.color ?? '#6aa0c8';
  box(g, x + 3, y + 3, w - 6, h * 0.62, mix(roof, '#e8e4dc', 0.35), 3, o.ppt >= 16);
  // awning stripes (owner colour + white) along the front
  const ay = y + 3 + h * 0.62;
  const stripes = Math.max(4, Math.round((w - 6) / 3));
  const sw = (w - 6) / stripes;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? '#f6f3ec' : o.ownerColor;
    g.fillRect(x + 3 + i * sw, ay, sw + 0.2, h * 0.14);
  }
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.fillRect(x + 3, ay + h * 0.14, w - 6, 1);
};

const warehouse: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#a9a49b', o.ppt);
  const detail = o.ppt >= 16;
  const rx = x + 3;
  const ry = y + 3;
  const rw = w - 6;
  const rh = h * 0.7;
  box(g, rx, ry, rw, rh, '#cfd1d2', 4, detail);
  if (detail) {
    g.strokeStyle = 'rgba(90,95,100,0.35)';
    g.lineWidth = 0.8;
    g.beginPath();
    for (let xx = rx + 4; xx < rx + rw - 1; xx += 4) {
      g.moveTo(xx, ry + 1);
      g.lineTo(xx, ry + rh - 1);
    }
    g.stroke();
  }
  g.fillStyle = o.ownerColor;
  g.fillRect(rx, ry + rh * 0.45, rw, 2.4);
  g.fillStyle = '#3f434a';
  const docks = Math.max(2, Math.floor(rw / 8));
  for (let i = 0; i < docks; i++) g.fillRect(rx + 3 + i * (rw / docks), ry + rh - 0.5, rw / docks - 3, 2.6);
  crates(g, x + 5, y + h * 0.78, 3, b.id, ['#c29a5a', '#a07a44', '#7a9ab8', '#c46a4a']);
};

const depot: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#6d7179', o.ppt);
  if (o.ppt >= 14) {
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 0.8;
    g.beginPath();
    for (let xx = x + 5; xx < x + w - 3; xx += 5) {
      g.moveTo(xx, y + h * 0.55);
      g.lineTo(xx, y + h - 4);
    }
    g.stroke();
  }
  box(g, x + 3, y + 3, w * 0.55, h * 0.4, '#d9d4ca', 3, o.ppt >= 16);
  g.fillStyle = o.ownerColor;
  g.fillRect(x + 3, y + 3, w * 0.55, 2.2);
};

const railStation: Drawer = (g, x, y, w, h, b, def, o) => {
  const along = w >= h;
  pad(g, x, y, w, h, '#b2aca2', o.ppt);
  // tracks through the long axis
  g.strokeStyle = '#8f8576';
  g.lineWidth = T * 0.4;
  g.beginPath();
  if (along) {
    g.moveTo(x, y + h * 0.7);
    g.lineTo(x + w, y + h * 0.7);
  } else {
    g.moveTo(x + w * 0.7, y);
    g.lineTo(x + w * 0.7, y + h);
  }
  g.stroke();
  g.strokeStyle = '#c4c8cf';
  g.lineWidth = 1;
  g.beginPath();
  for (const d of [-3.2, 3.2]) {
    if (along) {
      g.moveTo(x, y + h * 0.7 + d);
      g.lineTo(x + w, y + h * 0.7 + d);
    } else {
      g.moveTo(x + w * 0.7 + d, y);
      g.lineTo(x + w * 0.7 + d, y + h);
    }
  }
  g.stroke();
  // platform + canopy
  if (along) {
    box(g, x + 2, y + 3, w - 4, h * 0.4, '#e3ddd2', 2, o.ppt >= 16);
    box(g, x + w * 0.1, y + h * 0.18, w * 0.8, h * 0.18, mix(o.ownerColor, '#cfcac0', 0.4), 3, o.ppt >= 16);
  } else {
    box(g, x + 3, y + 2, w * 0.4, h - 4, '#e3ddd2', 2, o.ppt >= 16);
    box(g, x + w * 0.18, y + h * 0.1, w * 0.18, h * 0.8, mix(o.ownerColor, '#cfcac0', 0.4), 3, o.ppt >= 16);
  }
};

const harbor: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#b7b2a8', o.ppt);
  // pier planks
  g.fillStyle = '#8a6a48';
  g.fillRect(x + w * 0.1, y + h * 0.78, w * 0.8, h * 0.16);
  g.strokeStyle = 'rgba(60,40,20,0.5)';
  g.lineWidth = 0.6;
  g.beginPath();
  for (let xx = x + w * 0.1 + 2; xx < x + w * 0.9; xx += 2.5) {
    g.moveTo(xx, y + h * 0.78);
    g.lineTo(xx, y + h * 0.94);
  }
  g.stroke();
  // containers
  const cols = ['#c8503c', '#3c78b4', '#e0a030', '#4f9a5a', '#8a5ab0'];
  for (let i = 0; i < 6; i++) {
    const c = cols[hashInt(b.id, i, 5) % cols.length]!;
    const cx = x + 5 + (i % 3) * 9;
    const cy = y + 6 + ((i / 3) | 0) * 6;
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(cx + 1, cy + 1.2, 8, 4.4);
    g.fillStyle = c;
    g.fillRect(cx, cy, 8, 4.4);
    g.fillStyle = shade(c, 1.25);
    g.fillRect(cx, cy, 8, 1);
  }
  // crane
  const cx = x + w * 0.78;
  const cy = y + h * 0.55;
  const a = o.working && o.animate ? Math.sin(o.t * 0.6 + b.id) * 1.1 - 0.5 : -0.5;
  g.fillStyle = '#e0a030';
  g.fillRect(cx - 2.5, cy - 2.5, 5, 5);
  g.strokeStyle = '#e0a030';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(cx + Math.cos(a) * T * 0.7, cy + Math.sin(a) * T * 0.7);
  g.stroke();
};

const airport: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#5b6068', o.ppt);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.min(w, h) * 0.32;
  g.strokeStyle = '#f0d24a';
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#f2f2f2';
  g.font = `700 ${Math.round(r * 1.1)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('H', cx, cy + 0.5);
  if (o.animate) {
    g.fillStyle = Math.floor(o.t * 2) & 1 ? '#ff4a3a' : '#5a1a14';
    g.fillRect(x + 3, y + 3, 2, 2);
    g.fillRect(x + w - 5, y + h - 5, 2, 2);
  }
};

const lab: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#cfd6d2', o.ppt);
  box(g, x + 3, y + 3, w - 6, h * 0.55, '#f1f2ef', 3, o.ppt >= 16);
  g.fillStyle = o.ownerColor;
  g.fillRect(x + 3, y + 3 + h * 0.55 - 2, w - 6, 2);
  const cx = x + w * 0.65;
  const cy = y + h * 0.3;
  const r = Math.min(w, h) * 0.18;
  const grd = g.createRadialGradient(cx - r * 0.4, cy - r * 0.4, r * 0.1, cx, cy, r);
  grd.addColorStop(0, '#e6f6ff');
  grd.addColorStop(1, '#5f9ec8');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  // antenna blink
  if (o.animate) {
    g.fillStyle = Math.floor(o.t * 1.5 + b.id) & 1 ? '#ff5a4a' : '#7a2a24';
    g.beginPath();
    g.arc(x + w * 0.2, y + h * 0.25, 1.4, 0, Math.PI * 2);
    g.fill();
  }
};

const recycling: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#b8b8a8', o.ppt);
  box(g, x + 3, y + 3, w * 0.62, h * 0.6, '#6fa86a', 3, o.ppt >= 16);
  const cols = ['#3c78c8', '#e0c03a', '#4aa05a', '#8a8a8a'];
  for (let i = 0; i < 4; i++) {
    g.fillStyle = cols[i]!;
    g.fillRect(x + w * 0.7 + (i % 2) * 5, y + 5 + ((i / 2) | 0) * 5, 4, 4);
  }
  // conveyor
  g.fillStyle = '#4a4e56';
  g.fillRect(x + 4, y + h * 0.75, w - 8, 3);
  if (o.working && o.animate) {
    g.fillStyle = '#d8c070';
    const off = (o.t * 8) % 6;
    for (let xx = x + 4 + off; xx < x + w - 5; xx += 6) g.fillRect(xx, y + h * 0.75 + 0.5, 2, 2);
  }
  chimney(g, x + w * 0.82, y + h * 0.35, 2.4, o, false);
};

const wind: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#9cc27a', o.ppt);
  const a0 = o.working && o.animate ? o.t * 2.4 : 0.4;
  for (let ty = 0; ty < h / T - 0.01; ty++)
    for (let tx = 0; tx < w / T - 0.01; tx++) {
      const cx = x + (tx + 0.5) * T;
      const cy = y + (ty + 0.5) * T;
      const a = a0 + (tx * 1.3 + ty * 0.7);
      const L = T * 0.42;
      // blade shadow
      g.strokeStyle = 'rgba(0,0,0,0.18)';
      g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i < 3; i++) {
        const aa = a + (i * Math.PI * 2) / 3;
        g.moveTo(cx + 5, cy + 6);
        g.lineTo(cx + 5 + Math.cos(aa) * L, cy + 6 + Math.sin(aa) * L);
      }
      g.stroke();
      g.fillStyle = '#e8eaec';
      g.beginPath();
      g.arc(cx, cy, 2.6, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#f7f8f9';
      g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i < 3; i++) {
        const aa = a + (i * Math.PI * 2) / 3;
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(aa) * L, cy + Math.sin(aa) * L);
      }
      g.stroke();
      g.fillStyle = o.ownerColor;
      g.beginPath();
      g.arc(cx, cy, 1.3, 0, Math.PI * 2);
      g.fill();
    }
};

const solar: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#b8b49c', o.ppt);
  for (let yy = y + 3; yy < y + h - 5; yy += 6)
    for (let xx = x + 3; xx < x + w - 6; xx += 8) {
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(xx + 1, yy + 1.4, 7, 4.2);
      g.fillStyle = '#2f4f7f';
      g.fillRect(xx, yy, 7, 4.2);
      g.fillStyle = 'rgba(160,200,255,0.35)';
      g.fillRect(xx, yy, 7, 1);
      g.fillRect(xx + 3.4, yy, 0.5, 4.2);
    }
};

const powerplant: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#b3ada2', o.ppt);
  box(g, x + 3, y + h * 0.5, w * 0.55, h * 0.42, '#9aa0a8', 4, o.ppt >= 16);
  // cooling tower(s)
  const n = w >= 3 * T ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const cx = x + w * (n === 2 ? 0.28 + i * 0.4 : 0.35);
    const cy = y + h * 0.3;
    const r = Math.min(w, h) * 0.2;
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.arc(cx + 4, cy + 5, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#d6d3cc';
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#8f8a82';
    g.beginPath();
    g.arc(cx, cy, r * 0.72, 0, Math.PI * 2);
    g.fill();
    if (o.working && o.emit) o.emit('steam', cx, cy, 1.4);
  }
  chimney(g, x + w * 0.82, y + h * 0.7, 2.6, o, true);
  // lightning accent
  g.fillStyle = o.ownerColor;
  g.fillRect(x + 3, y + h * 0.5, w * 0.55, 2);
};

const hydro: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#a8b0b4', o.ppt);
  g.fillStyle = '#5a9cc4';
  g.fillRect(x + 3, y + 3, w - 6, h * 0.4);
  box(g, x + 2, y + h * 0.42, w - 4, h * 0.2, '#d0d0cc', 3, true);
};

const exportYard: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#a19c93', o.ppt);
  const cols = ['#c8503c', '#3c78b4', '#e0a030', '#4f9a5a', '#8a5ab0', '#d0d0d0'];
  let i = 0;
  for (let yy = y + 5; yy < y + h - 8; yy += 6)
    for (let xx = x + 5; xx < x + w - 10; xx += 10) {
      const c = cols[hashInt(b.id, i++, 9) % cols.length]!;
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(xx + 1, yy + 1.2, 9, 4.4);
      g.fillStyle = c;
      g.fillRect(xx, yy, 9, 4.4);
      g.fillStyle = shade(c, 1.25);
      g.fillRect(xx, yy, 9, 1);
    }
  // gantry
  const gx = x + w * ((o.working && o.animate ? (Math.sin(o.t * 0.3 + b.id) + 1) / 2 : 0.5) * 0.7 + 0.15);
  g.strokeStyle = '#e0a030';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(gx, y + 2);
  g.lineTo(gx, y + h - 2);
  g.stroke();
};

const hq: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#c9c6c0', o.ppt);
  const s = Math.min(w, h) * 0.7;
  const tx = x + (w - s) / 2 - 2;
  const ty = y + (h - s) / 2 - 2;
  box(g, tx, ty, s, s, '#8fa9c0', Math.max(8, s * 0.4), true);
  g.fillStyle = shade('#8fa9c0', 1.2);
  g.fillRect(tx + s * 0.18, ty + s * 0.18, s * 0.64, s * 0.64);
  g.fillStyle = o.ownerColor;
  g.fillRect(tx + s * 0.18, ty + s * 0.18, s * 0.64, s * 0.12);
};

const generic: Drawer = (g, x, y, w, h, b, def, o) => {
  pad(g, x, y, w, h, '#bdb6a8', o.ppt);
  box(g, x + 3, y + 3, w - 6, h - 8, def.color ?? '#9a9a9a', 4, o.ppt >= 16);
  g.fillStyle = o.ownerColor;
  g.fillRect(x + 3, y + 3, w - 6, 2);
};

const DRAWERS: Record<ArtKind, Drawer> = {
  farm,
  ranch,
  orchard,
  mine,
  quarry,
  lumber,
  oil,
  fishery,
  factory,
  shop,
  warehouse,
  depot,
  railStation,
  harbor,
  airport,
  lab,
  recycling,
  wind,
  solar,
  powerplant,
  hydro,
  export: exportYard,
  hq,
  datacenter,
  generic,
};

/** Draw full-detail art of a building footprint. */
export function drawBuildingArt(g: CanvasRenderingContext2D, kind: ArtKind, def: BuildingDef, b: ArtBuilding, o: ArtOptions): void {
  const x = b.x * T;
  const y = b.y * T;
  DRAWERS[kind](g, x, y, b.w * T, b.h * T, b, def, o);
}

/** Construction site: dirt pad, faded art, scaffolding, crane. */
export function drawConstruction(g: CanvasRenderingContext2D, kind: ArtKind, def: BuildingDef, b: ArtBuilding, o: ArtOptions, progress: number): void {
  const x = b.x * T;
  const y = b.y * T;
  const w = b.w * T;
  const h = b.h * T;
  rrect(g, x + 1, y + 1, w - 2, h - 2, 3);
  g.fillStyle = '#a58c6a';
  g.fill();
  g.save();
  g.globalAlpha = 0.25 + progress * 0.55;
  DRAWERS[kind](g, x, y, w, h, b, def, { ...o, working: false, emit: undefined });
  g.restore();
  // scaffolding
  g.strokeStyle = 'rgba(90,70,40,0.85)';
  g.lineWidth = 0.8;
  g.setLineDash([2, 1.5]);
  g.strokeRect(x + 3, y + 3, w - 6, h - 6);
  g.setLineDash([]);
  // tower crane
  if (o.ppt >= 14) {
    const cx = x + w - 6;
    const cy = y + 6;
    const a = o.animate ? Math.sin(o.t * 0.5 + b.id) * 1.2 + 2.4 : 2.4;
    g.strokeStyle = '#e8b02a';
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(cx - Math.cos(a) * 6, cy - Math.sin(a) * 6);
    g.lineTo(cx + Math.cos(a) * Math.min(w, h) * 0.8, cy + Math.sin(a) * Math.min(w, h) * 0.8);
    g.stroke();
    g.fillStyle = '#e8b02a';
    g.fillRect(cx - 2, cy - 2, 4, 4);
  }
}

