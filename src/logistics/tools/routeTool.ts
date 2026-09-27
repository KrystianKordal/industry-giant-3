/**
 * Route tool ('route', args { mode? }): click buildings / stations in sequence;
 * Enter (or clicking the first stop again) creates the route with default orders
 * (first = load all, last = unload all, middle = both) and buys the best affordable
 * vehicle. Backspace removes the last stop. Mode = args.mode, else the first
 * clicked station's mode (rail/water/air), else road.
 *
 * Auto-connect tool ('autoconnect'): click a producer, then a consumer → builds a
 * road if needed, creates the route and buys a truck (services.logistics.autoConnect).
 */
import type { GameContext } from '../../core/context';
import type { BuildingId, TransportMode } from '../../core/types';
import type { ToolDef, ToolStatus } from '../../input/types';
import { buildingName, stationModeOf, supportsMode } from '../access';
import { MODE_ICONS, MODE_NAMES } from '../constants';
import { defaultStops } from '../routes';
import { pickVehicleType } from '../vehicles';
import { buildingCenter, fail, label, money, T, tileOf } from './common';

export interface RouteToolArgs {
  mode?: TransportMode;
}

export function createRouteTool(ctx: GameContext): ToolDef {
  let stops: BuildingId[] = [];
  let mode: TransportMode | null = null;
  let forcedMode: TransportMode | null = null;
  let hoverB = 0;

  const player = (): number => ctx.state.playerCompanyId;

  const finish = (): void => {
    if (stops.length < 2 || !mode) {
      fail(ctx, 'Za mało przystanków', 'Wybierz co najmniej 2 budynki.');
      return;
    }
    const res = ctx.services.logistics.createRoute(player(), { mode, stops: defaultStops(stops) });
    if (!res.ok) {
      fail(ctx, 'Nie można utworzyć trasy', res.reason);
      return;
    }
    const warning = (res as { warning?: string }).warning;
    const typeId = pickVehicleType(ctx, player(), mode);
    let text = warning ?? '';
    if (typeId) {
      const bv = ctx.services.logistics.buyVehicle(player(), typeId, res.id);
      text = bv.ok ? `Kupiono: ${ctx.data.vehicles[typeId]?.name ?? typeId} (${money(bv.cost)}). ${text}` : `${bv.reason}. ${text}`;
    } else text = `Brak dostępnego pojazdu lub środków. ${text}`;
    ctx.ui.toast({ level: warning ? 'warning' : 'success', title: 'Utworzono trasę', text: text.trim(), target: { kind: 'route', id: res.id } });
    ctx.bus.emit('sfx', { id: 'success' });
    ctx.bus.emit('select', { kind: 'route', id: res.id });
    stops = [];
    mode = forcedMode;
  };

  return {
    id: 'route',
    name: 'Nowa trasa',
    icon: '🧭',
    cursor: 'pointer',
    activate(_c, args) {
      forcedMode = ((args ?? {}) as RouteToolArgs).mode ?? null;
      mode = forcedMode;
      stops = [];
    },
    deactivate() {
      stops = [];
    },
    pointerMove(e) {
      const i = tileOf(ctx, e);
      hoverB = i >= 0 ? ctx.state.map.building[i]! : 0;
    },
    click(e) {
      const i = tileOf(ctx, e);
      if (i < 0) return;
      const st = ctx.state;
      const bid = st.map.building[i]!;
      const b = bid ? st.buildings[bid] : undefined;
      if (!b) {
        fail(ctx, 'Kliknij budynek', 'Przystankami trasy są budynki, magazyny i stacje.');
        return;
      }
      const def = ctx.data.buildings[b.typeId];
      if (!stops.length && !forcedMode) {
        const m = stationModeOf(def);
        mode = m && m !== 'road' ? m : 'road';
      }
      const m = mode ?? 'road';
      if (stops.length >= 2 && bid === stops[0]) {
        finish();
        return;
      }
      if (bid === stops[stops.length - 1]) return;
      if (!supportsMode(def, m)) {
        fail(ctx, 'Zły typ przystanku', `${buildingName(ctx, b)} nie obsługuje transportu ${MODE_NAMES[m]}.`);
        return;
      }
      if (b.owner !== player() && b.owner !== 0 && !stops.length) {
        fail(ctx, 'Cudzy budynek', 'Trasa musi zaczynać się w Twoim budynku.');
        return;
      }
      stops.push(bid);
      ctx.bus.emit('sfx', { id: 'click' });
    },
    keyDown(e) {
      if (e.key === 'Enter') {
        finish();
        return true;
      }
      if (e.key === 'Backspace') {
        stops.pop();
        if (!stops.length) mode = forcedMode;
        return true;
      }
      return false;
    },
    cancel() {
      if (stops.length) {
        stops = [];
        mode = forcedMode;
        return true;
      }
      return false;
    },
    drawPreview(rc) {
      const st = rc.state;
      const g = rc.g;
      const hb = hoverB ? st.buildings[hoverB] : undefined;
      if (hb) {
        const ok = supportsMode(rc.data.buildings[hb.typeId], mode ?? 'road') || (!stops.length && !forcedMode);
        g.strokeStyle = ok ? 'rgba(120,230,140,0.95)' : 'rgba(255,90,70,0.95)';
        g.lineWidth = 3 / rc.zoom;
        g.strokeRect(hb.x * T, hb.y * T, hb.w * T, hb.h * T);
      }
      if (!stops.length) return;
      g.save();
      g.strokeStyle = 'rgba(232,176,74,0.95)';
      g.lineWidth = 3 / rc.zoom;
      g.setLineDash([8 / rc.zoom, 6 / rc.zoom]);
      g.beginPath();
      stops.forEach((id, k) => {
        const b = st.buildings[id];
        if (!b) return;
        const [cx, cy] = buildingCenter(b);
        if (k === 0) g.moveTo(cx, cy);
        else g.lineTo(cx, cy);
      });
      if (hb) {
        const [cx, cy] = buildingCenter(hb);
        g.lineTo(cx, cy);
      }
      g.stroke();
      g.setLineDash([]);
      stops.forEach((id, k) => {
        const b = st.buildings[id];
        if (!b) return;
        const [cx, cy] = buildingCenter(b);
        const r = 11 / rc.zoom;
        g.fillStyle = '#e8b04a';
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#1a1a1a';
        g.font = `700 ${13 / rc.zoom}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(k + 1), cx, cy);
      });
      g.restore();
      const last = st.buildings[stops[stops.length - 1]!];
      if (last) label(rc, `${MODE_ICONS[mode ?? 'road']} ${stops.length} przyst. · Enter = utwórz`, last.x + last.w, last.y);
    },
    hint: () => 'Klikaj budynki po kolei. Enter lub klik w pierwszy przystanek = utwórz trasę. Backspace = cofnij. Esc = wyjście.',
    status(): ToolStatus | null {
      if (!ctx.hasGame) return null;
      const st = ctx.state;
      return {
        icon: '🧭',
        title: `Nowa trasa (${MODE_NAMES[mode ?? 'road']})`,
        lines: stops.map((id, k) => {
          const b = st.buildings[id];
          return { label: `${k + 1}.`, value: b ? buildingName(ctx, b) : '?' };
        }),
        footer: 'Enter = utwórz · Backspace = cofnij · Esc = anuluj',
      };
    },
  };
}

export function createAutoConnectTool(ctx: GameContext): ToolDef {
  let first = 0;
  let hoverB = 0;
  const player = (): number => ctx.state.playerCompanyId;
  return {
    id: 'autoconnect',
    name: 'Auto-połączenie',
    icon: '🔗',
    cursor: 'pointer',
    activate() {
      first = 0;
    },
    pointerMove(e) {
      const i = tileOf(ctx, e);
      hoverB = i >= 0 ? ctx.state.map.building[i]! : 0;
    },
    click(e) {
      const i = tileOf(ctx, e);
      if (i < 0) return;
      const bid = ctx.state.map.building[i]!;
      const b = bid ? ctx.state.buildings[bid] : undefined;
      if (!b) {
        fail(ctx, 'Kliknij budynek');
        return;
      }
      if (!first) {
        if (b.owner !== player()) {
          fail(ctx, 'Wybierz własny budynek-producenta');
          return;
        }
        first = bid;
        ctx.bus.emit('sfx', { id: 'click' });
        return;
      }
      if (bid === first) return;
      const res = ctx.services.logistics.autoConnect(player(), first, bid, 'road');
      if (!res.ok) fail(ctx, 'Auto-połączenie nieudane', res.reason);
      else {
        const warning = (res as { warning?: string }).warning;
        ctx.ui.toast({
          level: warning ? 'warning' : 'success',
          title: 'Połączono',
          text: `Koszt: ${money(res.cost)}${warning ? `. ${warning}` : ''}`,
          target: { kind: 'route', id: res.routeId },
        });
        ctx.bus.emit('sfx', { id: 'success' });
      }
      first = 0;
    },
    cancel() {
      if (first) {
        first = 0;
        return true;
      }
      return false;
    },
    drawPreview(rc) {
      const g = rc.g;
      const a = first ? rc.state.buildings[first] : undefined;
      const hb = hoverB ? rc.state.buildings[hoverB] : undefined;
      g.save();
      g.lineWidth = 3 / rc.zoom;
      if (hb) {
        g.strokeStyle = 'rgba(120,200,255,0.95)';
        g.strokeRect(hb.x * T, hb.y * T, hb.w * T, hb.h * T);
      }
      if (a) {
        g.strokeStyle = 'rgba(232,176,74,0.95)';
        g.strokeRect(a.x * T, a.y * T, a.w * T, a.h * T);
        if (hb && hb.id !== a.id) {
          const [ax, ay] = buildingCenter(a);
          const [bx, by] = buildingCenter(hb);
          g.setLineDash([8 / rc.zoom, 6 / rc.zoom]);
          g.beginPath();
          g.moveTo(ax, ay);
          g.lineTo(bx, by);
          g.stroke();
        }
      }
      g.restore();
    },
    hint: () => (first ? 'Kliknij odbiorcę (fabrykę, sklep, magazyn).' : 'Kliknij producenta, potem odbiorcę — droga, trasa i pojazd powstaną automatycznie.'),
    status: () => ({ icon: '🔗', title: 'Auto-połączenie', message: first ? 'Wybierz odbiorcę' : 'Wybierz producenta', footer: 'Esc = anuluj' }),
  };
}
