/**
 * Placement-preview & highlight helpers for tools of other modules. Available
 * as `rc.helpers.*` inside any world-space layer / ToolDef.drawPreview(rc), or
 * import the functions directly from 'src/render/preview'.
 * All positions are in TILE units (integers = tile top-left; +0.5 = centre).
 */
import { TILE_SIZE } from '../core/constants';
import type { Building, TileIndex } from '../core/types';
import { artKindOf, drawBuildingArt, type ArtBuilding, type ArtOptions } from './art/buildings';
import { addPts, dirBetween, piecesFor } from './netGeom';
import type { RenderContext } from './types';
import { alpha } from './util/color';

const T = TILE_SIZE;
export const VALID_COLOR = '#4ade80';
export const INVALID_COLOR = '#f25f4c';
export const NEUTRAL_COLOR = '#7cc4ff';

const colorOf = (v: boolean | string): string => (typeof v === 'string' ? v : v ? VALID_COLOR : INVALID_COLOR);

/** Footprint rectangle: translucent fill, border, diagonal hatch when invalid. */
export function footprint(rc: RenderContext, x: number, y: number, w: number, h: number, valid: boolean | string = true, label?: string): void {
  const { g, zoom } = rc;
  const c = colorOf(valid);
  const px = x * T;
  const py = y * T;
  const pw = w * T;
  const ph = h * T;
  const pulse = rc.motion ? 0.25 + Math.sin(rc.timeMs / 220) * 0.06 : 0.25;
  g.fillStyle = alpha(c, pulse);
  g.fillRect(px, py, pw, ph);
  if (valid === false) {
    g.save();
    g.beginPath();
    g.rect(px, py, pw, ph);
    g.clip();
    g.strokeStyle = alpha(c, 0.55);
    g.lineWidth = 2 / zoom;
    g.beginPath();
    for (let d = -ph; d < pw; d += 8 / zoom + 4) {
      g.moveTo(px + d, py + ph);
      g.lineTo(px + d + ph, py);
    }
    g.stroke();
    g.restore();
  }
  g.strokeStyle = c;
  g.lineWidth = 2 / zoom;
  g.setLineDash([6 / zoom, 4 / zoom]);
  g.lineDashOffset = rc.motion ? -rc.timeMs / 60 / zoom : 0;
  g.strokeRect(px, py, pw, ph);
  g.setLineDash([]);
  g.lineDashOffset = 0;
  if (label) worldLabel(rc, x + w / 2, y + h + 0.1, label, c);
}

/** Highlight individual tiles (indices). */
export function tiles(rc: RenderContext, list: ArrayLike<TileIndex>, valid: boolean | string = true): void {
  const { g, state } = rc;
  const W = state.map.width;
  g.fillStyle = alpha(colorOf(valid), 0.35);
  for (let k = 0; k < list.length; k++) {
    const i = list[k]!;
    g.fillRect((i % W) * T + 1, ((i / W) | 0) * T + 1, T - 2, T - 2);
  }
}

/** Service / catchment radius circle around a tile-space centre. */
export function radius(rc: RenderContext, cx: number, cy: number, r: number, color = NEUTRAL_COLOR): void {
  const { g, zoom } = rc;
  g.fillStyle = alpha(color, 0.1);
  g.beginPath();
  g.arc(cx * T, cy * T, r * T, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = alpha(color, 0.8);
  g.lineWidth = 1.5 / zoom;
  g.setLineDash([8 / zoom, 5 / zoom]);
  g.stroke();
  g.setLineDash([]);
}

const ghostArt: ArtBuilding = { id: 0, x: 0, y: 0, w: 1, h: 1, rotation: 0, progress: 0.6 };
const ghostOpts: ArtOptions = { t: 0, working: false, ppt: 32, ownerColor: '#fff', productColor: '#c8b070', animate: false, pollution: 0 };

/** Semi-transparent building art + footprint, e.g. while choosing a spot. */
export function ghostBuilding(rc: RenderContext, typeId: string, x: number, y: number, rotation: 0 | 1 | 2 | 3 = 0, valid: boolean | string = true): void {
  const def = rc.data.buildings[typeId];
  if (!def) return;
  const w = rotation % 2 ? def.size.h : def.size.w;
  const h = rotation % 2 ? def.size.w : def.size.h;
  const g = rc.g;
  ghostArt.x = x;
  ghostArt.y = y;
  ghostArt.w = w;
  ghostArt.h = h;
  ghostArt.rotation = rotation;
  ghostOpts.t = rc.timeMs / 1000;
  ghostOpts.ppt = rc.ppt;
  ghostOpts.ownerColor = rc.state.companies[rc.state.playerCompanyId]?.color ?? '#fff';
  g.save();
  g.globalAlpha = 0.62;
  drawBuildingArt(g, artKindOf(def, rc.data), def, ghostArt, ghostOpts);
  g.restore();
  footprint(rc, x, y, w, h, valid);
  if (def.radius) radius(rc, x + w / 2, y + h / 2, def.radius, colorOf(valid));
}

/** Ghost road/rail along an ordered tile path (connects consecutive tiles and existing network). */
export function ghostNetwork(rc: RenderContext, path: ArrayLike<TileIndex>, kind: 'road' | 'rail', valid: boolean | string = true): void {
  const { g, state, zoom } = rc;
  const W = state.map.width;
  const net = kind === 'road' ? state.network.road : state.network.rail;
  const p = new Path2D();
  for (let k = 0; k < path.length; k++) {
    const i = path[k]!;
    const x = i % W;
    const y = (i / W) | 0;
    let m = 0;
    for (const n of [k - 1, k + 1]) {
      if (n < 0 || n >= path.length) continue;
      const j = path[n]!;
      m |= dirBetween(x, y, j % W, (j / W) | 0);
    }
    // join existing network at the ends
    if (k === 0 || k === path.length - 1)
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < state.map.height && net[ny * W + nx]) m |= dirBetween(x, y, nx, ny);
      }
    const pieces = piecesFor(m);
    if (!pieces.length) {
      p.moveTo((x + 0.5) * T, (y + 0.5) * T);
      p.lineTo((x + 0.52) * T, (y + 0.5) * T);
    }
    for (const pc of pieces) addPts(p, pc.pts, x, y, T);
  }
  const c = colorOf(valid);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = alpha(c, 0.35);
  g.lineWidth = T * 0.62;
  g.stroke(p);
  g.strokeStyle = kind === 'road' ? 'rgba(110,114,122,0.75)' : 'rgba(150,140,125,0.75)';
  g.lineWidth = T * (kind === 'road' ? 0.44 : 0.4);
  g.stroke(p);
  g.strokeStyle = kind === 'road' ? 'rgba(240,235,215,0.8)' : 'rgba(210,214,220,0.9)';
  g.lineWidth = Math.max(1 / zoom, T * 0.04);
  g.setLineDash(kind === 'road' ? [T * 0.14, T * 0.12] : [T * 0.06, T * 0.08]);
  g.stroke(p);
  g.setLineDash([]);
  g.lineCap = 'butt';
}

/** Pill label anchored at a tile position, constant screen size. */
export function worldLabel(rc: RenderContext, tx: number, ty: number, text: string, color = '#ffffff'): void {
  const { g, zoom } = rc;
  const fs = 12 / zoom;
  g.font = `600 ${fs}px system-ui, sans-serif`;
  const w = g.measureText(text).width + fs;
  const h = fs * 1.6;
  const x = tx * T - w / 2;
  const y = ty * T;
  g.fillStyle = 'rgba(14,18,26,0.85)';
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, h / 2);
  else g.rect(x, y, w, h);
  g.fill();
  g.strokeStyle = alpha(color, 0.8);
  g.lineWidth = 1 / zoom;
  g.stroke();
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, tx * T, y + h / 2 + fs * 0.05);
}

/** Polyline through tile centres (indices) or points (tile units). Animated dashes when `flow`. */
export function line(
  rc: RenderContext,
  pts: ArrayLike<TileIndex> | readonly { x: number; y: number }[],
  color: string,
  opts: { width?: number; dashed?: boolean; flow?: boolean; alpha?: number } = {},
): void {
  const { g, state, zoom } = rc;
  if (!pts.length) return;
  const W = state.map.width;
  g.beginPath();
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k]!;
    const x = typeof p === 'number' ? (p % W) + 0.5 : p.x;
    const y = typeof p === 'number' ? ((p / W) | 0) + 0.5 : p.y;
    if (k === 0) g.moveTo(x * T, y * T);
    else g.lineTo(x * T, y * T);
  }
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const w = (opts.width ?? 3) / zoom;
  g.strokeStyle = 'rgba(10,14,20,0.45)';
  g.lineWidth = w + 2 / zoom;
  g.stroke();
  g.strokeStyle = alpha(color, opts.alpha ?? 0.95);
  g.lineWidth = w;
  if (opts.dashed || opts.flow) {
    g.setLineDash([w * 3, w * 2]);
    g.lineDashOffset = opts.flow && rc.motion ? (-rc.timeMs / 40) / zoom : 0;
  }
  g.stroke();
  g.setLineDash([]);
  g.lineDashOffset = 0;
  g.lineCap = 'butt';
}

/** Arrow from (x0,y0) to (x1,y1) in tile units. */
export function arrow(rc: RenderContext, x0: number, y0: number, x1: number, y1: number, color = NEUTRAL_COLOR): void {
  const { g, zoom } = rc;
  const ax = x0 * T;
  const ay = y0 * T;
  const bx = x1 * T;
  const by = y1 * T;
  const a = Math.atan2(by - ay, bx - ax);
  const hs = 10 / zoom;
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 2.5 / zoom;
  g.beginPath();
  g.moveTo(ax, ay);
  g.lineTo(bx - Math.cos(a) * hs * 0.8, by - Math.sin(a) * hs * 0.8);
  g.stroke();
  g.beginPath();
  g.moveTo(bx, by);
  g.lineTo(bx - Math.cos(a - 0.45) * hs, by - Math.sin(a - 0.45) * hs);
  g.lineTo(bx - Math.cos(a + 0.45) * hs, by - Math.sin(a + 0.45) * hs);
  g.closePath();
  g.fill();
}

/** Glowing outline around a building (selection-like). */
export function highlightBuilding(rc: RenderContext, b: Pick<Building, 'x' | 'y' | 'w' | 'h'>, color = '#ffffff'): void {
  const { g, zoom } = rc;
  const pad = 3 / zoom + 1;
  g.strokeStyle = alpha(color, 0.35);
  g.lineWidth = 6 / zoom;
  g.strokeRect(b.x * T - pad, b.y * T - pad, b.w * T + pad * 2, b.h * T + pad * 2);
  g.strokeStyle = color;
  g.lineWidth = 2 / zoom;
  g.setLineDash([7 / zoom, 4 / zoom]);
  g.lineDashOffset = rc.motion ? -rc.timeMs / 50 / zoom : 0;
  g.strokeRect(b.x * T - pad, b.y * T - pad, b.w * T + pad * 2, b.h * T + pad * 2);
  g.setLineDash([]);
  g.lineDashOffset = 0;
}

export interface RenderHelpers {
  footprint: typeof footprint;
  tiles: typeof tiles;
  radius: typeof radius;
  ghostBuilding: typeof ghostBuilding;
  ghostNetwork: typeof ghostNetwork;
  label: typeof worldLabel;
  line: typeof line;
  arrow: typeof arrow;
  highlightBuilding: typeof highlightBuilding;
}

export const helpers: RenderHelpers = {
  footprint,
  tiles,
  radius,
  ghostBuilding,
  ghostNetwork,
  label: worldLabel,
  line,
  arrow,
  highlightBuilding,
};
