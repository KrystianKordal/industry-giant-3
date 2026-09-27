/**
 * Blueprint tool.
 *  - args { mode: 'select' }: drag a rectangle over your buildings/roads → name → saved in state.blueprints.
 *  - args { mode: 'paste', blueprintId }: preview (per-item validity, total cost), R = rotate, click = build.
 * Building goes through ctx.services.economy.build/setRecipe and
 * ctx.services.logistics.buildNetwork (network pieces are split into adjacent chains).
 */
import { TILE_SIZE } from '../../core/constants';
import type { GameContext } from '../../core/context';
import { footprintSize, type PlaceCheck } from '../../core/entities';
import { formatMoney } from '../../core/format';
import type { Blueprint, BlueprintItem, GameState } from '../../core/types';
import { promptDialog } from '../../ui/components';
import type { ToolDef, ToolStatus } from '../types';

const T = TILE_SIZE;

export type BlueprintToolArgs = { mode: 'select' } | { mode: 'paste'; blueprintId: string };

export interface PlacedItem extends BlueprintItem {
  w: number;
  h: number;
}
export interface RotatedBlueprint {
  w: number;
  h: number;
  items: PlacedItem[];
  network: Blueprint['network'];
}

/** Rotate a blueprint by rot × 90° clockwise. Pure (exported for tests). */
export function rotateBlueprint(bp: Blueprint, rot: number, fp: (typeId: string, r: number) => { w: number; h: number }): RotatedBlueprint {
  let w = bp.w;
  let h = bp.h;
  let items: PlacedItem[] = bp.items.map((it) => ({ ...it, ...fp(it.typeId, it.rotation) }));
  let network = bp.network.map((n) => ({ ...n }));
  for (let k = 0; k < ((rot % 4) + 4) % 4; k++) {
    const H = h;
    items = items.map((it) => {
      const r = ((it.rotation + 1) % 4) as 0 | 1 | 2 | 3;
      const f = fp(it.typeId, r);
      return { ...it, dx: H - it.dy - it.h, dy: it.dx, rotation: r, w: f.w, h: f.h };
    });
    network = network.map((n) => ({ ...n, dx: H - 1 - n.dy, dy: n.dx }));
    [w, h] = [h, w];
  }
  return { w, h, items, network };
}

/** Split tile indices into chains of 4-adjacent tiles (for buildNetwork's ordered paths). */
export function chainTiles(tiles: number[], width: number): number[][] {
  const set = new Set(tiles);
  const visited = new Set<number>();
  const chains: number[][] = [];
  const nbs = (i: number): number[] => {
    const x = i % width;
    const out = [i - width, i + width];
    if (x > 0) out.push(i - 1);
    if (x < width - 1) out.push(i + 1);
    return out.filter((n) => set.has(n) && !visited.has(n));
  };
  for (const s of tiles) {
    if (visited.has(s)) continue;
    const stack: [number | null, number][] = [[null, s]];
    while (stack.length) {
      const [from, t] = stack.pop()!;
      if (visited.has(t)) continue;
      visited.add(t);
      const chain = from !== null ? [from, t] : [t];
      let cur = t;
      for (;;) {
        const n = nbs(cur);
        if (!n.length) break;
        for (const r of n.slice(1)) stack.push([cur, r]);
        cur = n[0]!;
        visited.add(cur);
        chain.push(cur);
      }
      chains.push(chain);
    }
  }
  return chains;
}

/** Capture player's buildings + network inside a tile rect as a blueprint (not stored). */
export function captureBlueprint(st: GameState, x0: number, y0: number, x1: number, y1: number, name: string): Blueprint | null {
  const pid = st.playerCompanyId;
  const items: BlueprintItem[] = [];
  const net: Blueprint['network'] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number, w: number, h: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w - 1);
    maxY = Math.max(maxY, y + h - 1);
  };
  const buildings: { typeId: string; x: number; y: number; w: number; h: number; rotation: 0 | 1 | 2 | 3; recipeId: string | null }[] = [];
  for (const b of Object.values(st.buildings)) {
    if (b.owner !== pid) continue;
    if (b.x < x0 || b.y < y0 || b.x + b.w - 1 > x1 || b.y + b.h - 1 > y1) continue;
    buildings.push(b);
    grow(b.x, b.y, b.w, b.h);
  }
  const W = st.map.width;
  const roads: { x: number; y: number; road: number; rail: number }[] = [];
  for (let y = Math.max(0, y0); y <= Math.min(st.map.height - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      const i = y * W + x;
      const road = st.network.road[i]!;
      const rail = st.network.rail[i]!;
      if (!road && !rail) continue;
      roads.push({ x, y, road, rail });
      grow(x, y, 1, 1);
    }
  if (!buildings.length && !roads.length) return null;
  for (const b of buildings) items.push({ typeId: b.typeId, dx: b.x - minX, dy: b.y - minY, rotation: b.rotation, recipeId: b.recipeId });
  for (const r of roads) net.push({ dx: r.x - minX, dy: r.y - minY, road: r.road, rail: r.rail });
  return {
    id: `bp${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    name,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    items,
    network: net,
    createdDay: st.time.totalDays,
  };
}

export function createBlueprintTool(ctx: GameContext): ToolDef {
  let mode: 'select' | 'paste' = 'select';
  let bpId = '';
  let rot = 0;
  let drag: { x0: number; y0: number; x1: number; y1: number } | null = null;
  let hover: { tx: number; ty: number } | null = null;
  let cacheKey = '';
  let rotated: RotatedBlueprint | null = null;
  let checks: PlaceCheck[] = [];

  const fp = (typeId: string, r: number): { w: number; h: number } => {
    const d = ctx.data.buildings[typeId];
    return d ? footprintSize(d, r) : { w: 1, h: 1 };
  };
  const bp = (): Blueprint | undefined => ctx.tryState()?.blueprints[bpId];
  const origin = (): { ox: number; oy: number } | null => {
    if (!hover || !rotated) return null;
    return { ox: hover.tx - Math.floor(rotated.w / 2), oy: hover.ty - Math.floor(rotated.h / 2) };
  };

  const refresh = (force = false): void => {
    const b = bp();
    if (mode !== 'paste' || !b || !hover) return;
    const k = `${bpId}:${rot}:${hover.tx}:${hover.ty}`;
    if (!force && k === cacheKey) return;
    cacheKey = k;
    rotated = rotateBlueprint(b, rot, fp);
    const o = origin()!;
    const pid = ctx.state.playerCompanyId;
    checks = rotated.items.map((it) => {
      try {
        return ctx.services.economy.checkPlacement(pid, it.typeId, o.ox + it.dx, o.oy + it.dy, it.rotation);
      } catch (err) {
        return { ok: false, reason: String(err), cost: 0 };
      }
    });
  };

  const paste = (): void => {
    const b = bp();
    refresh(true);
    const o = origin();
    if (!b || !rotated || !o) return;
    const st = ctx.state;
    const pid = st.playerCompanyId;
    let built = 0;
    let cost = 0;
    const errors: string[] = [];
    for (const it of rotated.items) {
      const res = ctx.services.economy.build(pid, it.typeId, o.ox + it.dx, o.oy + it.dy, it.rotation);
      if (res.ok) {
        built++;
        cost += res.cost;
        if (it.recipeId) ctx.services.economy.setRecipe(res.id, it.recipeId);
      } else errors.push(`${ctx.data.buildings[it.typeId]?.name ?? it.typeId}: ${res.reason}`);
    }
    // network: group by kind + level, split into adjacent chains
    const W = st.map.width;
    const groups = new Map<string, number[]>();
    for (const n of rotated.network) {
      const x = o.ox + n.dx;
      const y = o.oy + n.dy;
      if (x < 0 || y < 0 || x >= W || y >= st.map.height) continue;
      const i = y * W + x;
      if (n.road) (groups.get(`road:${n.road}`) ?? groups.set(`road:${n.road}`, []).get(`road:${n.road}`)!).push(i);
      if (n.rail) (groups.get(`rail:${n.rail}`) ?? groups.set(`rail:${n.rail}`, []).get(`rail:${n.rail}`)!).push(i);
    }
    let netFail = 0;
    for (const [k, tiles] of groups) {
      const [kind, lvl] = k.split(':') as ['road' | 'rail', string];
      for (const chain of chainTiles(tiles, W)) {
        const res = ctx.services.logistics.buildNetwork(pid, kind, chain, Number(lvl));
        if (res.ok) cost += res.cost;
        else netFail++;
      }
    }
    if (netFail) errors.push(`Sieć: ${netFail} odcinków nie zbudowano`);
    ctx.ui.toast({
      level: errors.length ? (built ? 'warning' : 'danger') : 'success',
      icon: '📐',
      title: `Blueprint „${b.name}”: ${built}/${rotated.items.length} budynków`,
      text: `Koszt: ${formatMoney(cost)}${errors.length ? `\n${errors.slice(0, 3).join('\n')}` : ''}`,
    });
    if (!built && rotated.items.length) ctx.bus.emit('sfx', { id: 'error' });
    refresh(true);
  };

  return {
    id: 'blueprint',
    name: 'Blueprint',
    icon: '📐',
    cursor: 'crosshair',
    activate(_c, a) {
      const args = (a ?? { mode: 'select' }) as BlueprintToolArgs;
      mode = args.mode;
      bpId = args.mode === 'paste' ? args.blueprintId : '';
      rot = 0;
      drag = null;
      cacheKey = '';
      rotated = null;
      const hv = ctx.input.hover;
      hover = hv ? { tx: hv.x, ty: hv.y } : null;
      if (mode === 'paste') {
        const b = bp();
        if (b) rotated = rotateBlueprint(b, 0, fp);
      }
    },
    deactivate() {
      drag = null;
      hover = null;
    },
    pointerDown(e) {
      if (mode === 'select' && e.inMap) drag = { x0: e.tx, y0: e.ty, x1: e.tx, y1: e.ty };
    },
    pointerMove(e) {
      hover = e.inMap ? { tx: e.tx, ty: e.ty } : hover;
      if (mode === 'select' && drag) {
        drag.x1 = e.tx;
        drag.y1 = e.ty;
      }
      if (mode === 'paste') refresh();
    },
    pointerUp() {
      if (mode !== 'select' || !drag) return;
      const d = drag;
      drag = null;
      const x0 = Math.min(d.x0, d.x1);
      const x1 = Math.max(d.x0, d.x1);
      const y0 = Math.min(d.y0, d.y1);
      const y1 = Math.max(d.y0, d.y1);
      const st = ctx.state;
      const probe = captureBlueprint(st, x0, y0, x1, y1, 'tmp');
      if (!probe) {
        ctx.ui.toast({ level: 'warning', icon: '📐', title: 'Pusty obszar', text: 'Zaznacz obszar zawierający Twoje budynki lub drogi.', durationMs: 3000 });
        return;
      }
      const layer = ctx.ui.root;
      if (!layer) return;
      const n = Object.keys(st.blueprints).length + 1;
      void promptDialog(layer, 'Zapisz blueprint', `${probe.items.length} budynków, ${probe.network.length} pól sieci (${probe.w}×${probe.h}). Nazwa:`, `Układ ${n}`, 'Zapisz').then((name) => {
        if (!name || !ctx.hasGame) return;
        probe.name = name;
        ctx.state.blueprints[probe.id] = probe;
        ctx.ui.toast({ level: 'success', icon: '📐', title: `Zapisano blueprint „${name}”`, text: 'Wklej go z panelu Blueprinty [P].' });
        ctx.ui.refreshPanel('blueprints');
        ctx.bus.emit('sfx', { id: 'success' });
      });
    },
    click(e) {
      if (mode === 'paste' && e.inMap) {
        hover = { tx: e.tx, ty: e.ty };
        paste();
      }
    },
    keyDown(e) {
      if (mode === 'paste' && (e.key === 'r' || e.key === 'R')) {
        rot = (rot + (e.shiftKey ? 3 : 1)) % 4;
        refresh(true);
        return true;
      }
      return false;
    },
    cancel() {
      if (drag) {
        drag = null;
        return true;
      }
      return false;
    },
    drawPreview({ g, zoom, timeMs }) {
      if (mode === 'select') {
        if (!drag) return;
        const x0 = Math.min(drag.x0, drag.x1);
        const y0 = Math.min(drag.y0, drag.y1);
        const w = Math.abs(drag.x1 - drag.x0) + 1;
        const h = Math.abs(drag.y1 - drag.y0) + 1;
        g.fillStyle = 'rgba(74,158,224,0.15)';
        g.fillRect(x0 * T, y0 * T, w * T, h * T);
        g.save();
        g.setLineDash([8 / zoom, 5 / zoom]);
        g.lineDashOffset = -timeMs / 40;
        g.strokeStyle = '#7ec0ff';
        g.lineWidth = 2 / zoom;
        g.strokeRect(x0 * T, y0 * T, w * T, h * T);
        g.restore();
        return;
      }
      refresh();
      const o = origin();
      if (!rotated || !o) return;
      g.fillStyle = 'rgba(140,150,165,0.45)';
      for (const n of rotated.network) g.fillRect((o.ox + n.dx) * T + 6, (o.oy + n.dy) * T + 6, T - 12, T - 12);
      rotated.items.forEach((it, i) => {
        const ok = checks[i]?.ok;
        g.fillStyle = ok ? 'rgba(92,196,134,0.35)' : 'rgba(224,86,74,0.35)';
        g.fillRect((o.ox + it.dx) * T, (o.oy + it.dy) * T, it.w * T, it.h * T);
        g.strokeStyle = ok ? '#5cc486' : '#e0564a';
        g.lineWidth = 2 / zoom;
        g.strokeRect((o.ox + it.dx) * T, (o.oy + it.dy) * T, it.w * T, it.h * T);
        const icon = ctx.data.buildings[it.typeId]?.icon ?? '?';
        g.font = `${Math.round(Math.min(it.w, it.h) * T * 0.5)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = '#fff';
        g.fillText(icon, (o.ox + it.dx + it.w / 2) * T, (o.oy + it.dy + it.h / 2) * T);
      });
      g.save();
      g.setLineDash([6 / zoom, 6 / zoom]);
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.lineWidth = 1 / zoom;
      g.strokeRect(o.ox * T, o.oy * T, rotated.w * T, rotated.h * T);
      g.restore();
    },
    hint: () =>
      mode === 'select'
        ? '📐 Przeciągnij, aby zaznaczyć obszar z budynkami do zapisania — Esc: anuluj'
        : `📐 Wklejanie „${bp()?.name ?? ''}” — LPM: buduj · R: obróć · Esc: zakończ`,
    status: (): ToolStatus | null => {
      if (mode === 'select') {
        if (!drag) return { icon: '📐', title: 'Zaznacz obszar', message: 'Przeciągnij lewym przyciskiem myszy' };
        return { icon: '📐', title: `Obszar ${Math.abs(drag.x1 - drag.x0) + 1}×${Math.abs(drag.y1 - drag.y0) + 1}` };
      }
      const b = bp();
      if (!b || !rotated || !hover) return null;
      const okN = checks.filter((c) => c.ok).length;
      const cost = checks.reduce((a, c) => a + c.cost, 0);
      const cash = ctx.state.companies[ctx.state.playerCompanyId]?.cash ?? 0;
      const firstBad = checks.find((c) => !c.ok);
      return {
        icon: '📐',
        title: b.name,
        ok: okN === checks.length && cost <= cash,
        message: firstBad ? firstBad.reason : cost > cash ? 'Brak środków na całość' : 'Kliknij, aby zbudować',
        lines: [
          { label: 'Budynki', value: `${okN}/${checks.length} możliwych`, tone: okN === checks.length ? 'pos' : 'warn' },
          { label: 'Koszt budynków', value: formatMoney(cost), tone: cost > cash ? 'neg' : undefined },
          { label: 'Pola sieci', value: String(rotated.network.length), tone: 'dim' },
        ],
        footer: 'R: obróć · Esc: zakończ',
      };
    },
  };
}
