/**
 * Buildings layer (z=30): procedural art per archetype with semantic zoom,
 * company colour accents, construction sites, smoke/steam emitters, product
 * badges and status indicators.
 */
import { TILE_SIZE } from '../../core/constants';
import type { GameContext } from '../../core/context';
import type { Building, BuildingStatus } from '../../core/types';
import type { BuildingDef } from '../../data/defs';
import { artKindOf, drawBuildingArt, drawConstruction, type ArtBuilding, type ArtOptions } from '../art/buildings';
import type { Effects } from '../effects';
import { PUBLIC_COLOR } from '../palette';
import type { LayerDef, RenderContext } from '../types';
import { alpha, shade } from '../util/color';
import { drawEmoji } from '../util/sprites';

const T = TILE_SIZE;

export const STATUS_BADGE: Partial<Record<BuildingStatus, { icon: string; color: string; label: string }>> = {
  noInput: { icon: '📥', color: '#f0a030', label: 'Brak surowców' },
  outputFull: { icon: '📦', color: '#e8c030', label: 'Magazyn pełny' },
  noWorkers: { icon: '👷', color: '#e85a4a', label: 'Brak pracowników' },
  noDeposit: { icon: '⛏️', color: '#e85a4a', label: 'Złoże wyczerpane' },
  noCustomers: { icon: '🛒', color: '#9aa3ad', label: 'Brak klientów' },
  noPower: { icon: '⚡', color: '#f0d030', label: 'Brak prądu' },
  damaged: { icon: '🔧', color: '#e85a4a', label: 'Uszkodzony' },
  noPermit: { icon: '🚫', color: '#e85a4a', label: 'Brak pozwolenia' },
  disabled: { icon: '⏸️', color: '#9aa3ad', label: 'Wyłączony' },
};

const productCache = new Map<string, { icon: string; color: string } | null>();
function mainProduct(ctx: GameContext, b: Building, def: BuildingDef): { icon: string; color: string } | null {
  const rid = b.recipeId ?? def.recipes[0];
  const key = rid ?? `#${def.id}`;
  const hit = productCache.get(key);
  if (hit !== undefined) return hit;
  const rec = rid ? ctx.data.recipes[rid] : undefined;
  const pid = rec?.outputs[0]?.product ?? def.sells?.[0];
  const p = pid ? ctx.data.products[pid] : undefined;
  const res = p ? { icon: p.icon, color: p.color ?? '#c8b070' } : null;
  productCache.set(key, res);
  return res;
}

/** Is the building actively working (animations, smoke). */
export const isWorking = (b: Building): boolean => b.status === 'ok' && b.enabled && b.constructionProgress >= 1;

export function createBuildingsLayer(ctx: GameContext, fx: Effects): LayerDef {
  const art: ArtBuilding = { id: 0, x: 0, y: 0, w: 1, h: 1, rotation: 0, progress: 0 };
  let emitDt = 0;
  let emitCam = 1;
  const opts: ArtOptions = {
    t: 0,
    working: false,
    ppt: 32,
    ownerColor: '#fff',
    productColor: '#c8b070',
    animate: true,
    pollution: 0,
    emit: (kind, wx, wy, rate) => {
      if (Math.random() > rate * emitDt * 2.2) return;
      const s = Math.min(1.6, Math.max(0.7, emitCam));
      if (kind === 'steam') fx.steam(wx, wy, s * 1.2);
      else fx.smoke(wx, wy, s, kind === 'dark');
    },
  };

  const draw = (rc: RenderContext): void => {
    const { g, state, view, data } = rc;
    const far = rc.detail === 'far';
    const t = rc.timeMs / 1000;
    emitDt = rc.motion ? Math.min(0.1, rc.dtMs / 1000) : 0;
    emitCam = rc.zoom;
    opts.t = t;
    opts.ppt = rc.ppt;
    opts.animate = rc.motion;
    const z = rc.zoom;
    const badgeWorld = (px: number): number => px / z;

    for (const key in state.buildings) {
      const b = state.buildings[key]!;
      if (b.x + b.w < view.x0 || b.y + b.h < view.y0 || b.x > view.x1 || b.y > view.y1) continue;
      const def = data.buildings[b.typeId];
      if (!def) continue;
      const owner = state.companies[b.owner];
      const oc = owner?.color ?? PUBLIC_COLOR;
      const x = b.x * T;
      const y = b.y * T;
      const w = b.w * T;
      const h = b.h * T;
      const building = b.constructionProgress < 1;
      const prod = mainProduct(ctx, b, def);

      if (far) {
        // simplified block + owner border
        g.fillStyle = building ? alpha(def.color ?? '#999', 0.5) : (def.color ?? '#999');
        g.beginPath();
        if (g.roundRect) g.roundRect(x + 2, y + 2, w - 4, h - 4, 4);
        else g.rect(x + 2, y + 2, w - 4, h - 4);
        g.fill();
        g.strokeStyle = oc;
        g.lineWidth = Math.max(2, 2.2 / z);
        g.stroke();
        continue;
      }

      art.id = b.id;
      art.x = b.x;
      art.y = b.y;
      art.w = b.w;
      art.h = b.h;
      art.rotation = b.rotation;
      art.progress = b.progress;
      opts.ownerColor = oc;
      opts.productColor = prod?.color ?? def.color ?? '#c8b070';
      opts.working = isWorking(b);
      opts.pollution = Math.max(0, def.pollution) / 3;
      const kind = artKindOf(def, data);
      if (building) drawConstruction(g, kind, def, art, opts, b.constructionProgress);
      else {
        drawBuildingArt(g, kind, def, art, opts);
        if (!b.enabled || b.status === 'disabled') {
          g.fillStyle = 'rgba(90,95,105,0.45)';
          g.fillRect(x + 1, y + 1, w - 2, h - 2);
        }
      }
      // owner flag (small corner triangle)
      g.fillStyle = oc;
      g.beginPath();
      g.moveTo(x + 1, y + 1);
      g.lineTo(x + Math.min(10, w * 0.3), y + 1);
      g.lineTo(x + 1, y + Math.min(10, h * 0.3));
      g.closePath();
      g.fill();
    }

    // ---------------- badges (second pass so they sit on top of neighbours)
    for (const key in state.buildings) {
      const b = state.buildings[key]!;
      if (b.x + b.w < view.x0 || b.y + b.h < view.y0 || b.x > view.x1 || b.y > view.y1) continue;
      const def = data.buildings[b.typeId];
      if (!def) continue;
      const x = b.x * T;
      const y = b.y * T;
      const w = b.w * T;
      const h = b.h * T;
      const owner = state.companies[b.owner];
      const oc = owner?.color ?? PUBLIC_COLOR;
      const building = b.constructionProgress < 1;

      // product / building icon
      const prod = mainProduct(ctx, b, def);
      const icon = far ? def.icon : (prod?.icon ?? def.icon);
      if (far) {
        const s = Math.min(Math.min(w, h) * 0.9, badgeWorld(18));
        if (s * z >= 7) drawEmoji(g, icon, x + w / 2, y + h / 2, s, s * z * rc.dpr);
      } else if (rc.ppt >= 14) {
        const r = Math.min(T * 0.34, badgeWorld(11));
        const bx = x + r + 2;
        const by = y + h - r - 2;
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.beginPath();
        g.arc(bx + 1, by + 1.5, r, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#fbfaf6';
        g.beginPath();
        g.arc(bx, by, r, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = oc;
        g.lineWidth = Math.max(1, r * 0.18);
        g.stroke();
        drawEmoji(g, icon, bx, by, r * 1.35, r * 1.35 * z * rc.dpr);
      }

      // construction progress bar
      if (building) {
        const bw = w * 0.8;
        const bh = Math.max(3, badgeWorld(5));
        const bx = x + (w - bw) / 2;
        const by = y + h * 0.5 - bh / 2;
        g.fillStyle = 'rgba(20,22,28,0.75)';
        g.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
        g.fillStyle = '#f0c040';
        g.fillRect(bx, by, bw * b.constructionProgress, bh);
        continue;
      }

      // status indicator
      const st = b.status === 'ok' && !b.enabled ? 'disabled' : b.status;
      const sb = STATUS_BADGE[st];
      if (!sb) continue;
      const r = far ? badgeWorld(5) : Math.min(T * 0.36, badgeWorld(10));
      const pulse = rc.motion ? 1 + Math.sin(t * 5 + b.id) * 0.08 : 1;
      const bx = x + w - r * 0.9;
      const by = y + r * 0.9 - (rc.motion && !far ? Math.abs(Math.sin(t * 2.5 + b.id)) * r * 0.25 : 0);
      if (far) {
        g.fillStyle = sb.color;
        g.beginPath();
        g.arc(bx, by, r, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#fff';
        g.lineWidth = r * 0.3;
        g.stroke();
        continue;
      }
      g.fillStyle = alpha(sb.color, 0.35);
      g.beginPath();
      g.arc(bx, by, r * 1.35 * pulse, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = shade(sb.color, 0.35);
      g.beginPath();
      g.arc(bx, by, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = sb.color;
      g.lineWidth = Math.max(1, r * 0.2);
      g.stroke();
      drawEmoji(g, sb.icon, bx, by, r * 1.3, r * 1.3 * z * rc.dpr);
    }
  };

  return { id: 'buildings', z: 30, draw };
}
