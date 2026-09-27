/**
 * Input-owned render layers: selection highlight (z=80, id 'input-selection'),
 * active tool preview (z=90) and hover outline (z=100).
 */
import { TILE_SIZE } from '../core/constants';
import type { GameContext } from '../core/context';
import type { Selection } from '../core/events';
import type { LayerDef } from '../render/types';
import type { InputManager } from './input';

const T = TILE_SIZE;

export function createInputLayers(ctx: GameContext, input: InputManager): LayerDef[] {
  let selected: Selection = { kind: 'none' };
  ctx.bus.on('select', (s) => {
    selected = s;
  });
  ctx.bus.on('game:ended', () => {
    selected = { kind: 'none' };
  });

  return [
    {
      id: 'input-selection',
      z: 80,
      visible: () => selected.kind !== 'none',
      draw({ g, state, zoom, timeMs, alpha }) {
        const pulse = 0.55 + 0.45 * Math.sin(timeMs / 220);
        g.lineWidth = 2.5 / zoom;
        g.strokeStyle = `rgba(245,201,107,${0.6 + 0.4 * pulse})`;
        if (selected.kind === 'building') {
          const b = state.buildings[selected.id];
          if (!b) return;
          const pad = 3 + pulse * 2;
          g.strokeRect(b.x * T - pad, b.y * T - pad, b.w * T + pad * 2, b.h * T + pad * 2);
          // highlight route partners
          g.save();
          g.setLineDash([6 / zoom, 5 / zoom]);
          g.lineDashOffset = -timeMs / 50;
          g.lineWidth = 1.5 / zoom;
          for (const r of Object.values(state.routes)) {
            if (!r.stops.some((s) => s.buildingId === b.id)) continue;
            g.strokeStyle = r.color || 'rgba(245,201,107,0.7)';
            g.beginPath();
            r.stops.forEach((s, i) => {
              const sb = state.buildings[s.buildingId];
              if (!sb) return;
              const x = (sb.x + sb.w / 2) * T;
              const y = (sb.y + sb.h / 2) * T;
              if (i === 0) g.moveTo(x, y);
              else g.lineTo(x, y);
            });
            if (r.stops.length > 2) g.closePath();
            g.stroke();
          }
          g.restore();
        } else if (selected.kind === 'vehicle') {
          const v = state.vehicles[selected.id];
          if (!v) return;
          const x = (v.prevX + (v.x - v.prevX) * alpha) * T;
          const y = (v.prevY + (v.y - v.prevY) * alpha) * T;
          g.beginPath();
          g.arc(x, y, T * (0.55 + 0.1 * pulse), 0, Math.PI * 2);
          g.stroke();
          // remaining path
          if (v.path.length > 1) {
            const W = state.map.width;
            g.save();
            g.globalAlpha = 0.5;
            g.setLineDash([4 / zoom, 4 / zoom]);
            g.beginPath();
            g.moveTo(x, y);
            for (let i = Math.max(0, v.pathIndex + 1); i < v.path.length; i++) {
              const p = v.path[i]!;
              g.lineTo(((p % W) + 0.5) * T, (Math.floor(p / W) + 0.5) * T);
            }
            g.stroke();
            g.restore();
          }
        } else if (selected.kind === 'city') {
          const c = state.cities[selected.id];
          if (!c) return;
          g.save();
          g.setLineDash([10 / zoom, 6 / zoom]);
          g.beginPath();
          g.arc((c.x + 0.5) * T, (c.y + 0.5) * T, (c.radius + 1) * T, 0, Math.PI * 2);
          g.stroke();
          g.restore();
        } else if (selected.kind === 'route') {
          const r = state.routes[selected.id];
          if (!r) return;
          g.strokeStyle = r.color || '#f5c96b';
          g.beginPath();
          r.stops.forEach((s, i) => {
            const sb = state.buildings[s.buildingId];
            if (!sb) return;
            const x = (sb.x + sb.w / 2) * T;
            const y = (sb.y + sb.h / 2) * T;
            if (i === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
            g.strokeRect(sb.x * T - 2, sb.y * T - 2, sb.w * T + 4, sb.h * T + 4);
          });
          g.stroke();
        } else if (selected.kind === 'tile') {
          g.strokeRect(selected.x * T, selected.y * T, T, T);
        }
      },
    },
    {
      id: 'tool-preview',
      z: 90,
      draw: (rc) => input.activeTool?.drawPreview?.(rc),
    },
    {
      id: 'hover',
      z: 100,
      visible: () => input.activeToolId === 'inspect' || input.activeToolId === 'pick',
      draw({ g, zoom }) {
        const h = ctx.input.hover;
        if (!h) return;
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = 2 / zoom;
        g.strokeRect(h.x * T, h.y * T, T, T);
      },
    },
  ];
}
