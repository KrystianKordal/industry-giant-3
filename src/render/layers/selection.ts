/**
 * Selection highlight (z=80): follows the bus 'select' event.
 *  building → animated outline (+ service radius), vehicle → ring + remaining
 *  path + target stop, route → legs with flowing dashes and numbered stops,
 *  city → dashed radius circle, tile → outline.
 */
import { TILE_SIZE } from '../../core/constants';
import type { GameContext } from '../../core/context';
import type { Selection } from '../../core/events';
import { routeLegs, vehicleTarget } from '../../logistics/api';
import { highlightBuilding, line, radius } from '../preview';
import type { LayerDef, RenderContext } from '../types';
import { alpha } from '../util/color';

const T = TILE_SIZE;

export function createSelectionLayer(ctx: GameContext): LayerDef {
  let sel: Selection = { kind: 'none' };
  ctx.bus.on('select', (s) => {
    sel = s;
  });
  ctx.bus.on('game:started', () => {
    sel = { kind: 'none' };
  });

  const drawRoute = (rc: RenderContext, routeId: number): void => {
    const st = rc.state;
    const r = st.routes[routeId];
    if (!r) return;
    let legs: ReturnType<typeof routeLegs> = [];
    try {
      legs = routeLegs(ctx, routeId);
    } catch {
      legs = [];
    }
    for (let k = 0; k < r.stops.length; k++) {
      const leg = legs[k];
      if (leg && leg.length) line(rc, leg, r.color, { width: 4, flow: true });
      else {
        const a = st.buildings[r.stops[k]!.buildingId];
        const b = st.buildings[r.stops[(k + 1) % r.stops.length]!.buildingId];
        if (a && b && r.stops.length > 1)
          line(rc, [{ x: a.x + a.w / 2, y: a.y + a.h / 2 }, { x: b.x + b.w / 2, y: b.y + b.h / 2 }], '#f25f4c', { width: 2.5, dashed: true });
      }
    }
    const g = rc.g;
    const z = rc.zoom;
    r.stops.forEach((s, i) => {
      const b = st.buildings[s.buildingId];
      if (!b) return;
      highlightBuilding(rc, b, r.color);
      const cx = (b.x + b.w / 2) * T;
      const cy = b.y * T - 10 / z;
      const rr = 9 / z;
      g.fillStyle = r.color;
      g.beginPath();
      g.arc(cx, cy, rr, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5 / z;
      g.stroke();
      g.fillStyle = '#111';
      g.font = `700 ${11 / z}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(i + 1), cx, cy + 0.5 / z);
    });
  };

  return {
    id: 'selection',
    z: 80,
    visible: () => sel.kind !== 'none',
    draw(rc) {
      const { g, state, zoom } = rc;
      const t = rc.timeMs / 1000;
      switch (sel.kind) {
        case 'building': {
          const b = state.buildings[sel.id];
          if (!b) return;
          const def = rc.data.buildings[b.typeId];
          if (def?.radius) radius(rc, b.x + b.w / 2, b.y + b.h / 2, def.radius, state.companies[b.owner]?.color ?? '#7cc4ff');
          highlightBuilding(rc, b, '#ffffff');
          break;
        }
        case 'vehicle': {
          const v = state.vehicles[sel.id];
          if (!v) return;
          if (v.path.length > 1 && v.pathIndex < v.path.length - 1) {
            const rest = v.path.slice(v.pathIndex + 1);
            line(rc, rest, state.routes[v.routeId ?? 0]?.color ?? '#ffffff', { width: 2.5, dashed: true, alpha: 0.8 });
          }
          const tb = state.buildings[vehicleTarget(state, v)];
          if (tb) highlightBuilding(rc, tb, '#ffe27a');
          const px = (v.prevX + (v.x - v.prevX) * rc.alpha) * T;
          const py = (v.prevY + (v.y - v.prevY) * rc.alpha) * T;
          const r = T * 0.55 + (rc.motion ? Math.sin(t * 5) * 2 : 0);
          g.strokeStyle = alpha('#ffffff', 0.4);
          g.lineWidth = 6 / zoom;
          g.beginPath();
          g.arc(px, py, r, 0, Math.PI * 2);
          g.stroke();
          g.strokeStyle = '#ffffff';
          g.lineWidth = 2 / zoom;
          g.stroke();
          break;
        }
        case 'route':
          drawRoute(rc, sel.id);
          break;
        case 'city': {
          const c = state.cities[sel.id];
          if (!c) return;
          radius(rc, c.x + 0.5, c.y + 0.5, c.radius + 0.8, '#ffe27a');
          break;
        }
        case 'tile': {
          g.strokeStyle = '#ffffff';
          g.lineWidth = 2 / zoom;
          g.setLineDash([5 / zoom, 3 / zoom]);
          g.lineDashOffset = rc.motion ? -rc.timeMs / 60 / zoom : 0;
          g.strokeRect(sel.x * T, sel.y * T, T, T);
          g.setLineDash([]);
          g.lineDashOffset = 0;
          break;
        }
        case 'company':
        default:
          break;
      }
    },
  };
}
