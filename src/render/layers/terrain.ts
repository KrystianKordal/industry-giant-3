/**
 * Terrain layer (z=0): chunk-cached tile colors with elevation hill-shading,
 * forest speckles and rivers. Render agent: replace/extend freely.
 */
import type { GameContext } from '../../core/context';
import { TileFlag, type GameState } from '../../core/types';
import { ChunkCache } from '../chunkCache';
import type { LayerDef } from '../types';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function createTerrainLayer(ctx: GameContext): LayerDef {
  const palette = ctx.data.terrain.map((t) => hexToRgb(t.color));

  const drawChunk = (g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, state: GameState, ppt: number): void => {
    const { map } = state;
    const W = map.width;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * W + x;
        const t = map.terrain[i]!;
        const [r, gg, b] = palette[t] ?? [255, 0, 255];
        const e = map.elevation[i]!;
        const west = x > 0 ? map.elevation[i - 1]! : e;
        const north = y > 0 ? map.elevation[i - W]! : e;
        const slope = (west - e + (north - e)) / 255;
        const hash = ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0) % 100;
        const k = 0.9 + (e / 255) * 0.2 - slope * 1.5 + (hash - 50) / 1500;
        g.fillStyle = `rgb(${Math.min(255, r * k) | 0},${Math.min(255, gg * k) | 0},${Math.min(255, b * k) | 0})`;
        const px = (x - x0) * ppt;
        const py = (y - y0) * ppt;
        g.fillRect(px, py, ppt, ppt);
        if (map.forest[i]! > 0 && ppt >= 8) {
          g.fillStyle = 'rgba(20,50,25,0.55)';
          const n = 1 + ((map.forest[i]! / 90) | 0);
          for (let k2 = 0; k2 < n; k2++) {
            const hx = ((hash * (k2 + 3) * 7) % 10) / 10;
            const hy = ((hash * (k2 + 5) * 3) % 10) / 10;
            g.beginPath();
            g.arc(px + (0.15 + hx * 0.7) * ppt, py + (0.15 + hy * 0.7) * ppt, ppt * 0.16, 0, Math.PI * 2);
            g.fill();
          }
        }
        if (map.flags[i]! & TileFlag.River) {
          g.fillStyle = '#3a7fb5';
          g.fillRect(px + ppt * 0.3, py, ppt * 0.4, ppt);
        }
      }
    }
  };

  const cache = new ChunkCache({ pxPerTile: 16, drawChunk });
  return {
    id: 'terrain',
    z: 0,
    draw: (rc) => cache.draw(rc),
    invalidate: (r) => cache.invalidate(r),
  };
}
