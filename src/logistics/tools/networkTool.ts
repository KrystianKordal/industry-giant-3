/**
 * Road / rail construction tools ('road', 'rail').
 * Drag = path from start to cursor (A* along the cheapest terrain; Shift = straight
 * L-shape, Ctrl flips the L), click = single tile. Q cycles the level
 * (dirt/paved/highway, standard/electrified/high-speed). Preview shows tiles
 * (green = new, grey = existing, blue = bridge, red = invalid) and total cost.
 */
import type { GameContext } from '../../core/context';
import type { TileIndex } from '../../core/types';
import type { RenderContext } from '../../render/types';
import type { ToolDef, ToolPointerEvent, ToolStatus } from '../../input/types';
import { bestLevel, estimatePath, levelName, levelUnlocked, lPath, maxLevel, planBetween, type NetKind, type NetworkEstimate } from '../network';
import { rt } from '../runtime';
import { fail, fillTile, label, money, tileOf } from './common';

export interface NetworkToolArgs {
  level?: number;
}

export function createNetworkTool(ctx: GameContext, kind: NetKind): ToolDef {
  let level = 1;
  let start = -1;
  let cursor = -1;
  let dragging = false;
  let shift = false;
  let flip = false;
  let path: TileIndex[] = [];
  let est: NetworkEstimate | null = null;
  let key = '';

  const player = (): number => ctx.state.playerCompanyId;
  const noun = kind === 'road' ? 'drogi' : 'torów';

  const recompute = (): void => {
    if (!ctx.hasGame || cursor < 0) {
      path = [];
      est = null;
      key = '';
      return;
    }
    const k = `${dragging ? start : -1}:${cursor}:${shift}:${flip}:${level}:${ctx.state.network.version}`;
    if (k === key) return;
    key = k;
    if (dragging && start >= 0 && start !== cursor) {
      const W = ctx.state.map.width;
      path = shift ? lPath(W, start, cursor, flip) : (planBetween(ctx, kind, [start], [cursor], player()) ?? lPath(W, start, cursor, flip));
    } else path = [cursor];
    est = estimatePath(ctx, player(), kind, path, level);
  };

  const update = (e: ToolPointerEvent): void => {
    cursor = tileOf(ctx, e);
    shift = e.shift;
    flip = e.ctrl;
    recompute();
  };

  const commit = (tiles: TileIndex[]): void => {
    const res = ctx.services.logistics.buildNetwork(player(), kind, tiles, level);
    if (!res.ok) fail(ctx, `Nie można zbudować ${noun}`, res.reason);
    key = '';
    recompute();
  };

  return {
    id: kind,
    name: kind === 'road' ? 'Budowa dróg' : 'Budowa torów',
    icon: kind === 'road' ? '🛣️' : '🛤️',
    cursor: 'crosshair',
    activate(c, args) {
      if (!c.hasGame) return;
      const a = (args ?? {}) as NetworkToolArgs;
      level = a.level && levelUnlocked(c, kind, a.level) ? a.level : bestLevel(c, kind);
      start = -1;
      dragging = false;
      rt(c); // warm runtime
    },
    deactivate() {
      start = -1;
      dragging = false;
      path = [];
      est = null;
    },
    pointerDown(e) {
      start = tileOf(ctx, e);
      dragging = false;
    },
    pointerMove(e) {
      if (e.dragStart && start >= 0) dragging = true;
      update(e);
    },
    pointerUp(e) {
      update(e);
      if (dragging && path.length) commit(path);
      dragging = false;
      start = -1;
      key = '';
    },
    click(e) {
      const i = tileOf(ctx, e);
      if (i >= 0) commit([i]);
    },
    keyDown(e) {
      if (e.key.toLowerCase() !== 'q') return false;
      for (let k = 1; k <= maxLevel(kind); k++) {
        const next = ((level - 1 + k) % maxLevel(kind)) + 1;
        if (levelUnlocked(ctx, kind, next)) {
          level = next;
          break;
        }
      }
      key = '';
      recompute();
      ctx.bus.emit('sfx', { id: 'click' });
      return true;
    },
    cancel() {
      if (dragging || start >= 0) {
        dragging = false;
        start = -1;
        key = '';
        recompute();
        return true;
      }
      return false;
    },
    drawPreview(rc: RenderContext) {
      if (!est || !path.length) return;
      const checks = est.checks;
      est.tiles.forEach((i, k) => {
        const c = checks[k];
        const color = !c || !c.ok ? 'rgba(255,70,60,0.55)' : c.existing ? 'rgba(200,200,200,0.35)' : c.bridge ? 'rgba(80,160,255,0.55)' : 'rgba(90,220,110,0.5)';
        fillTile(rc, i, color, kind === 'road' ? 3 : 6);
      });
      const W = rc.state.map.width;
      const last = path[path.length - 1]!;
      const text = est.ok ? `${levelName(kind, level)} · ${money(est.cost)}` : `${est.reason ?? 'Błąd'} (${money(est.cost)})`;
      label(rc, text, (last % W) + 1, Math.floor(last / W), est.ok ? '#bff5c4' : '#ffb4a8');
    },
    hint: () =>
      `Przeciągnij, aby zbudować ${noun} (Shift = prosto w L, Ctrl = odwróć L). Klik = jedno pole. Q = rodzaj. Esc = wyjście.`,
    status(): ToolStatus | null {
      if (!ctx.hasGame) return null;
      const lines = [{ label: 'Rodzaj', value: levelName(kind, level) }];
      if (est) {
        lines.push({ label: 'Koszt', value: money(est.cost) });
        lines.push({ label: 'Nowe pola', value: String(est.newTiles) });
        if (est.bridgeTiles) lines.push({ label: 'Mosty', value: String(est.bridgeTiles) });
      }
      return {
        icon: kind === 'road' ? '🛣️' : '🛤️',
        title: kind === 'road' ? 'Budowa drogi' : 'Budowa torów',
        ok: est ? est.ok : undefined,
        message: est && !est.ok ? est.reason : undefined,
        lines,
        footer: 'Przeciągnij · Shift = L · Q = rodzaj · Esc = wyjście',
      };
    },
  };
}
