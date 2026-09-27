/**
 * PLACEHOLDER layers so every module can see its data on the map early:
 * network (z=10), houses (z=20), buildings (z=30), vehicles (z=40), grid, fps.
 * The render agent replaces these (register a layer with the same id).
 */
import { TILE_SIZE } from '../../core/constants';
import type { GameContext } from '../../core/context';
import { lerp } from '../../core/util';
import type { LayerDef } from '../types';

const T = TILE_SIZE;

export function createPlaceholderLayers(ctx: GameContext): LayerDef[] {
  const network: LayerDef = {
    id: 'network',
    z: 10,
    draw({ g, state, view }) {
      const { road, rail } = state.network;
      const W = state.map.width;
      for (let y = view.y0; y < view.y1; y++)
        for (let x = view.x0; x < view.x1; x++) {
          const i = y * W + x;
          if (road[i]) {
            g.fillStyle = road[i] === 1 ? '#8a7555' : '#4a4d52';
            g.fillRect(x * T + 4, y * T + 4, T - 8, T - 8);
          }
          if (rail[i]) {
            g.strokeStyle = '#2a2a2a';
            g.lineWidth = 3;
            g.strokeRect(x * T + 8, y * T + 8, T - 16, T - 16);
          }
        }
    },
  };

  const houses: LayerDef = {
    id: 'houses',
    z: 20,
    draw({ g, state, view }) {
      const { house } = state.map;
      const W = state.map.width;
      for (let y = view.y0; y < view.y1; y++)
        for (let x = view.x0; x < view.x1; x++) {
          const h = house[y * W + x]!;
          if (!h) continue;
          g.fillStyle = ['#000', '#b8a48a', '#a88f74', '#9a8a80', '#8a8a92', '#7a8aa0'][h] ?? '#999';
          const pad = 6 - h;
          g.fillRect(x * T + pad, y * T + pad, T - pad * 2, T - pad * 2);
        }
    },
  };

  const buildings: LayerDef = {
    id: 'buildings',
    z: 30,
    draw({ g, state, view, data, zoom }) {
      for (const b of Object.values(state.buildings)) {
        if (b.x + b.w < view.x0 || b.y + b.h < view.y0 || b.x > view.x1 || b.y > view.y1) continue;
        const def = data.buildings[b.typeId];
        const owner = state.companies[b.owner];
        g.globalAlpha = b.constructionProgress < 1 ? 0.5 : 1;
        g.fillStyle = def?.color ?? '#999';
        g.fillRect(b.x * T + 2, b.y * T + 2, b.w * T - 4, b.h * T - 4);
        g.strokeStyle = owner?.color ?? '#fff';
        g.lineWidth = 2;
        g.strokeRect(b.x * T + 2, b.y * T + 2, b.w * T - 4, b.h * T - 4);
        g.globalAlpha = 1;
        if (zoom >= 0.4 && def) {
          g.font = `${Math.min(b.w, b.h) * T * 0.5}px sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(def.icon, (b.x + b.w / 2) * T, (b.y + b.h / 2) * T);
        }
      }
    },
  };

  const vehicles: LayerDef = {
    id: 'vehicles',
    z: 40,
    draw({ g, state, alpha }) {
      for (const v of Object.values(state.vehicles)) {
        const x = lerp(v.prevX, v.x, alpha) * T;
        const y = lerp(v.prevY, v.y, alpha) * T;
        g.fillStyle = state.companies[v.owner]?.color ?? '#fff';
        g.beginPath();
        g.arc(x, y, T * 0.22, 0, Math.PI * 2);
        g.fill();
      }
    },
  };

  const grid: LayerDef = {
    id: 'grid',
    z: 65,
    visible: (rc) => rc.ctx.userSettings.showGrid && rc.zoom >= 0.5,
    draw({ g, view, zoom }) {
      g.strokeStyle = 'rgba(0,0,0,0.15)';
      g.lineWidth = 1 / zoom;
      g.beginPath();
      for (let x = view.x0; x <= view.x1; x++) {
        g.moveTo(x * T, view.y0 * T);
        g.lineTo(x * T, view.y1 * T);
      }
      for (let y = view.y0; y <= view.y1; y++) {
        g.moveTo(view.x0 * T, y * T);
        g.lineTo(view.x1 * T, y * T);
      }
      g.stroke();
    },
  };

  const fps: LayerDef = {
    id: 'fps',
    z: 1000,
    space: 'screen',
    visible: (rc) => rc.ctx.userSettings.showFps,
    draw({ g, width }) {
      g.font = '12px monospace';
      g.fillStyle = '#9fe870';
      g.textAlign = 'right';
      g.fillText(`${ctx.renderer.fps} FPS`, width - 8, 60);
    },
  };

  return [network, houses, buildings, vehicles, grid, fps];
}
