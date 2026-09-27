/**
 * Water animation (z=2): subtle drifting glints on water tiles. Batched into a
 * few alpha buckets (4 strokes per frame). Close/mid zoom only.
 */
import { TILE_SIZE } from '../../core/constants';
import type { LayerDef } from '../types';
import { hashInt } from '../util/noise';
import { Terrain } from '../../core/types';

const T = TILE_SIZE;
const BUCKETS = 4;

export function createWaterLayer(): LayerDef {
  const paths: Path2D[] = [];
  return {
    id: 'water-anim',
    z: 2,
    visible: (rc) => rc.motion && rc.ppt >= 12,
    draw(rc) {
      const { g, state, view } = rc;
      const { terrain } = state.map;
      const W = state.map.width;
      const t = rc.timeMs / 1000;
      for (let b = 0; b < BUCKETS; b++) paths[b] = new Path2D();
      let any = false;
      for (let y = view.y0; y < view.y1; y++)
        for (let x = view.x0; x < view.x1; x++) {
          const tt = terrain[y * W + x]!;
          if (tt > Terrain.Water) continue;
          const h = hashInt(x, y, 404);
          if ((h & 255) > 110) continue;
          const phase = ((h >>> 8) & 1023) / 162.9;
          const s = Math.sin(t * 0.9 + phase);
          if (s <= 0.15) continue;
          const b = Math.min(BUCKETS - 1, ((s - 0.15) / 0.85) * BUCKETS) | 0;
          const drift = ((t * 0.08 + phase) % 1) * 0.3;
          const px = (x + 0.15 + ((h >>> 18) & 63) / 100 + drift) * T;
          const py = (y + 0.2 + ((h >>> 24) & 63) / 100) * T;
          const len = T * (0.14 + (h & 7) * 0.02);
          const p = paths[b]!;
          p.moveTo(px, py);
          p.quadraticCurveTo(px + len / 2, py - T * 0.05, px + len, py);
          any = true;
        }
      if (!any) return;
      g.lineCap = 'round';
      g.lineWidth = Math.max(1, T * 0.045);
      for (let b = 0; b < BUCKETS; b++) {
        g.strokeStyle = `rgba(235,248,255,${(0.12 + b * 0.1).toFixed(2)})`;
        g.stroke(paths[b]!);
      }
      g.lineCap = 'butt';
    },
  };
}
