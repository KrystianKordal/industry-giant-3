/**
 * Bulldoze tool ('bulldoze'): click = remove own road/rail on the tile; drag =
 * remove all own road/rail in the rectangle (refund REFUND_RATE). Clicking an own
 * building twice demolishes it (through ctx.services.economy.demolish).
 */
import type { GameContext } from '../../core/context';
import type { TileIndex } from '../../core/types';
import type { ToolDef, ToolStatus } from '../../input/types';
import { canRemove, refundFor } from '../network';
import { fail, label, money, strokeRect, T, tileOf } from './common';

export function createBulldozeTool(ctx: GameContext): ToolDef {
  let start: { x: number; y: number } | null = null;
  let cur: { x: number; y: number } | null = null;
  let dragging = false;
  let armedBuilding = 0;

  const player = (): number => ctx.state.playerCompanyId;

  const rect = (): { x: number; y: number; w: number; h: number } | null => {
    if (!cur) return null;
    const a = dragging && start ? start : cur;
    const x = Math.min(a.x, cur.x);
    const y = Math.min(a.y, cur.y);
    return { x, y, w: Math.abs(a.x - cur.x) + 1, h: Math.abs(a.y - cur.y) + 1 };
  };

  const tilesIn = (r: { x: number; y: number; w: number; h: number }): { road: TileIndex[]; rail: TileIndex[]; refund: number } => {
    const { width: W, height: H } = ctx.state.map;
    const road: TileIndex[] = [];
    const rail: TileIndex[] = [];
    let refund = 0;
    for (let y = Math.max(0, r.y); y < Math.min(H, r.y + r.h); y++)
      for (let x = Math.max(0, r.x); x < Math.min(W, r.x + r.w); x++) {
        const i = y * W + x;
        if (canRemove(ctx, player(), 'road', i).ok) {
          road.push(i);
          refund += refundFor(ctx, 'road', i);
        }
        if (canRemove(ctx, player(), 'rail', i).ok) {
          rail.push(i);
          refund += refundFor(ctx, 'rail', i);
        }
      }
    return { road, rail, refund };
  };

  const removeIn = (r: { x: number; y: number; w: number; h: number }): boolean => {
    const t = tilesIn(r);
    let any = false;
    if (t.road.length) any = ctx.services.logistics.removeNetwork(player(), 'road', t.road).ok || any;
    if (t.rail.length) any = ctx.services.logistics.removeNetwork(player(), 'rail', t.rail).ok || any;
    return any;
  };

  return {
    id: 'bulldoze',
    name: 'Rozbiórka',
    icon: '🚜',
    cursor: 'crosshair',
    activate() {
      start = null;
      dragging = false;
      armedBuilding = 0;
    },
    pointerDown(e) {
      start = e.inMap ? { x: e.tx, y: e.ty } : null;
      dragging = false;
    },
    pointerMove(e) {
      cur = e.inMap ? { x: e.tx, y: e.ty } : null;
      if (e.dragStart && start) dragging = true;
    },
    pointerUp(e) {
      cur = e.inMap ? { x: e.tx, y: e.ty } : cur;
      if (dragging) {
        const r = rect();
        if (r && !removeIn(r)) fail(ctx, 'Nic do rozebrania', 'Brak własnych dróg lub torów w zaznaczeniu.');
      }
      dragging = false;
      start = null;
    },
    click(e) {
      const i = tileOf(ctx, e);
      if (i < 0) return;
      const st = ctx.state;
      if (removeIn({ x: e.tx, y: e.ty, w: 1, h: 1 })) {
        armedBuilding = 0;
        return;
      }
      const bid = st.map.building[i]!;
      const b = bid ? st.buildings[bid] : undefined;
      if (b && b.owner === player()) {
        if (armedBuilding !== bid) {
          armedBuilding = bid;
          ctx.ui.toast({ level: 'info', title: 'Kliknij ponownie, aby wyburzyć', text: ctx.data.buildings[b.typeId]?.name ?? '' });
          return;
        }
        armedBuilding = 0;
        const res = ctx.services.economy.demolish(bid);
        if (!res.ok) fail(ctx, 'Nie można wyburzyć', res.reason);
        return;
      }
      const reason = st.network.road[i] || st.network.rail[i] ? canRemove(ctx, player(), st.network.road[i] ? 'road' : 'rail', i).reason : 'Brak dróg, torów lub własnego budynku';
      fail(ctx, 'Nic do rozebrania', reason);
    },
    cancel() {
      if (dragging || armedBuilding) {
        dragging = false;
        start = null;
        armedBuilding = 0;
        return true;
      }
      return false;
    },
    drawPreview(rc) {
      const r = rect();
      if (!r) return;
      rc.g.fillStyle = 'rgba(255,60,40,0.18)';
      rc.g.fillRect(r.x * T, r.y * T, r.w * T, r.h * T);
      strokeRect(rc, r.x, r.y, r.w, r.h, 'rgba(255,90,60,0.9)');
      if (armedBuilding) {
        const b = rc.state.buildings[armedBuilding];
        if (b) {
          rc.g.fillStyle = 'rgba(255,40,30,0.35)';
          rc.g.fillRect(b.x * T, b.y * T, b.w * T, b.h * T);
        }
      }
      const t = tilesIn(r);
      if (t.refund > 0) label(rc, `Zwrot: ${money(t.refund)}`, r.x + r.w, r.y, '#ffd0c4');
    },
    hint: () => 'Klik = usuń drogę/tory na polu, przeciągnij = obszar. Dwuklik na własnym budynku = wyburzenie. Esc = wyjście.',
    status(): ToolStatus | null {
      if (!ctx.hasGame) return null;
      const r = rect();
      const t = r ? tilesIn(r) : null;
      return {
        icon: '🚜',
        title: 'Rozbiórka',
        lines: t ? [
          { label: 'Drogi', value: String(t.road.length) },
          { label: 'Tory', value: String(t.rail.length) },
          { label: 'Zwrot', value: money(t.refund), tone: 'pos' },
        ] : [],
        footer: 'Klik / przeciągnij · 2× klik na budynku = wyburz',
      };
    },
  };
}
