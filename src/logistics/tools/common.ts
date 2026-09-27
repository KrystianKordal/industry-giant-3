/**
 * Shared helpers for logistics tools (drawing previews, feedback).
 */
import { TILE_SIZE } from '../../core/constants';
import type { GameContext } from '../../core/context';
import type { Building } from '../../core/types';
import type { RenderContext } from '../../render/types';

export const T = TILE_SIZE;

export function fillTile(rc: RenderContext, i: number, color: string, pad = 1): void {
  const W = rc.state.map.width;
  const x = i % W;
  const y = (i - x) / W;
  if (x < rc.view.x0 - 1 || y < rc.view.y0 - 1 || x > rc.view.x1 || y > rc.view.y1) return;
  rc.g.fillStyle = color;
  rc.g.fillRect(x * T + pad, y * T + pad, T - pad * 2, T - pad * 2);
}

export function strokeRect(rc: RenderContext, x: number, y: number, w: number, h: number, color: string, width = 2): void {
  rc.g.strokeStyle = color;
  rc.g.lineWidth = width / rc.zoom;
  rc.g.strokeRect(x * T, y * T, w * T, h * T);
}

/** Text label in world space at tile coords, constant screen size. */
export function label(rc: RenderContext, text: string, tx: number, ty: number, color = '#fff', size = 13): void {
  const g = rc.g;
  g.save();
  g.font = `600 ${size / rc.zoom}px system-ui, sans-serif`;
  g.textAlign = 'left';
  g.textBaseline = 'bottom';
  const px = tx * T + 6 / rc.zoom;
  const py = ty * T - 4 / rc.zoom;
  const w = g.measureText(text).width;
  g.fillStyle = 'rgba(12,16,22,0.8)';
  g.fillRect(px - 4 / rc.zoom, py - (size + 4) / rc.zoom, w + 8 / rc.zoom, (size + 6) / rc.zoom);
  g.fillStyle = color;
  g.fillText(text, px, py);
  g.restore();
}

export function buildingCenter(b: Building): [number, number] {
  return [(b.x + b.w / 2) * T, (b.y + b.h / 2) * T];
}

export function fail(ctx: GameContext, title: string, text?: string): void {
  ctx.ui.toast({ level: 'warning', title, text });
  ctx.bus.emit('sfx', { id: 'error' });
}

export function money(n: number): string {
  return `${Math.round(n).toLocaleString('pl-PL')} zł`;
}

/** Tile index of a pointer event or -1. */
export function tileOf(ctx: GameContext, e: { tx: number; ty: number; inMap: boolean }): number {
  return e.inMap ? e.ty * ctx.state.map.width + e.tx : -1;
}
